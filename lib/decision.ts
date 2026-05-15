import type {
  AhrefsMetrics,
  ClientInputs,
  Decision,
  LocalRelevanceRating,
  Opportunity,
  PaymentType,
  SerpResult,
  SponsorshipCrawlResult,
} from "@/lib/types";

export function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function containsCaseInsensitive(haystack: string, needle: string): boolean {
  if (!needle) return false;
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function classifyLocalRelevance(
  serp: SerpResult,
  inputs: ClientInputs,
): { rating: LocalRelevanceRating; notes: string } {
  const blob = `${serp.title} ${serp.url}`;
  const city = inputs.client_primary_city;
  const state = inputs.client_state;
  const abbrev = inputs.state_abbrev;
  const county = inputs.county;
  const metro = inputs.metro;

  const cityHit = containsCaseInsensitive(blob, city);
  const serviceHit = (inputs.service_area_cities ?? []).some((c) =>
    containsCaseInsensitive(blob, c),
  );
  const countyHit = !!county && containsCaseInsensitive(blob, county);
  const metroHit = !!metro && containsCaseInsensitive(blob, metro);
  const stateHit =
    containsCaseInsensitive(blob, state) ||
    (!!abbrev && containsCaseInsensitive(blob, abbrev));

  if (cityHit) {
    return { rating: "High", notes: `Primary city "${city}" found in title or URL` };
  }
  if (serviceHit) {
    return { rating: "High", notes: "Service-area city found in title or URL" };
  }
  if (countyHit) {
    return { rating: "High", notes: `County "${county}" found in title or URL` };
  }
  if (metroHit) {
    return { rating: "Medium", notes: `Metro "${metro}" found in title or URL` };
  }
  if (stateHit) {
    return { rating: "Medium", notes: "State found but no city/metro/county match — verify locality" };
  }
  return {
    rating: "Unknown",
    notes: "No geo match in title or URL — verify locality during human review",
  };
}

function siteTrustScore(metrics: AhrefsMetrics): number {
  const dr = metrics.dr;
  if (dr === null) return 3;
  if (dr >= 40) return 10;
  if (dr >= 15) return 6;
  if (dr > 0) return 3;
  return 0;
}

function trafficScore(metrics: AhrefsMetrics): number {
  const t = metrics.organic_traffic;
  if (t === null) return 2;
  if (t >= 1000) return 5;
  if (t > 0) return 3;
  return 0;
}

function relevanceScore(rating: LocalRelevanceRating): number {
  if (rating === "High") return 35;
  if (rating === "Medium") return 20;
  return 0;
}

export interface DecisionContext {
  serp: SerpResult;
  inputs: ClientInputs;
  metrics: AhrefsMetrics;
  crawl: SponsorshipCrawlResult;
}

function linkScore(status: SponsorshipCrawlResult["linkOpportunityStatus"]): number {
  if (status === "Confirmed") return 30;
  if (status === "Probable") return 20;
  if (status === "Unclear") return 8;
  return 0;
}

function paymentScore(type: PaymentType): number {
  if (type === "One-Time") return 20;
  if (type === "Annual") return 10;
  if (type === "Unknown") return 8;
  if (type === "Monthly" || type === "Recurring") return 0;
  return 8;
}

export function buildOpportunity(ctx: DecisionContext): Opportunity {
  const { serp, inputs, metrics, crawl } = ctx;
  const https = isHttps(serp.url);

  const { rating, notes: localNotes } = classifyLocalRelevance(serp, inputs);

  let decision: Decision;
  const triggers: string[] = [];
  const notes: string[] = [crawl.crawlNotes || "Crawl completed."];

  if (crawl.crawlError) {
    notes.push(`Crawl error: ${crawl.crawlError}`);
  }

  if (!https) {
    decision = "Reject";
    notes.push("Auto-reject: site is not HTTPS (SOP §6.3, §11.5).");
  } else if (rating === "Low") {
    decision = "Reject";
    notes.push("Local relevance scored Low; rejected per SOP.");
  } else if (crawl.linkOpportunityStatus === "No Link Opportunity") {
    decision = "Reject";
    notes.push("No web sponsorship/link opportunity was identified.");
  } else if (
    crawl.linkOpportunityStatus === "Confirmed" &&
    (rating === "High" || rating === "Medium") &&
    crawl.submissionMethod !== "Unknown" &&
    (crawl.paymentType === "One-Time" || crawl.paymentType === "Annual")
  ) {
    decision = "Approve";
    if (rating === "Medium") triggers.push("Local relevance Medium — verify");
    if (crawl.paymentType === "Annual") triggers.push("Annual payment — verify budget and value");
  } else if (
    crawl.linkOpportunityStatus === "Confirmed" &&
    (rating === "High" || rating === "Medium")
  ) {
    decision = "Needs Human Review";
    triggers.push("Confirmed link opportunity but pricing or terms need verification");
  } else if (
    crawl.linkOpportunityStatus === "Probable" &&
    (rating === "High" || rating === "Medium")
  ) {
    decision = "Needs Human Review";
    triggers.push("Probable backlink opportunity — verify link details and pricing");
  } else if (
    crawl.linkOpportunityStatus === "Unclear" &&
    (rating === "High" || rating === "Medium")
  ) {
    decision = "Needs Human Review";
    triggers.push("Sponsorship evidence is unclear — verify sponsor page details");
  } else if (crawl.linkOpportunityStatus === "Unknown") {
    decision = "Needs Human Review";
    triggers.push("Link opportunity could not be classified automatically.");
  } else {
    decision = "Reject";
    triggers.push("Candidate does not meet sponsorship or local relevance criteria.");
  }

  if (crawl.paymentType === "Unknown") {
    triggers.push("Payment terms unknown");
  }
  if (crawl.submissionMethod === "Unknown") {
    triggers.push("Submission path not confirmed");
  }

  if (rating === "Unknown") {
    triggers.push("Locality unclear from SERP metadata");
  }

  const score =
    decision === "Reject"
      ? 0
      : relevanceScore(rating) +
        linkScore(crawl.linkOpportunityStatus) +
        paymentScore(crawl.paymentType, crawl.paymentAmount, inputs.maximum_approved_budget) +
        siteTrustScore(metrics) +
        trafficScore(metrics);

  const drVal = metrics.dr ?? "Unknown";
  const trafficVal = metrics.organic_traffic ?? "Unknown";

  if (metrics.error) {
    notes.push(`Ahrefs: ${metrics.error}`);
  }

  return {
    Client: inputs.client_business_name,
    "Target City": serp.target_city,
    "Opportunity Name": serp.title || serp.root_domain,
    Domain: serp.root_domain,
    "Opportunity Type": crawl.opportunityType,
    "Sponsorship URL": crawl.sponsorshipUrl || serp.url,
    "Sponsor Page URL": crawl.sponsorPageUrl,
    City: crawl.city,
    State: crawl.state || serp.target_state,
    "Local Relevance Rating": rating,
    "Local Relevance Notes": localNotes,
    "Current Sponsors Displayed Publicly": crawl.currentSponsorsDisplayedPublicly,
    "Current Sponsors Linked": crawl.currentSponsorsLinked,
    "Link Opportunity Status": crawl.linkOpportunityStatus,
    "Link Evidence": crawl.linkEvidence,
    "Payment Amount": crawl.paymentAmount,
    "Payment Type": crawl.paymentType,
    "Cheapest Tier With Link": crawl.cheapestTierWithLink,
    "Tier Name": crawl.tierName,
    "Submission Method": crawl.submissionMethod,
    "Submission URL": crawl.submissionUrl,
    "Contact Email": crawl.contactEmail,
    "Contact Person": crawl.contactPerson,
    DR: drVal,
    DA: "Unknown",
    Traffic: trafficVal,
    HTTPS: https ? "Yes" : "No",
    "Freshness / Site Quality Notes": crawl.freshnessSiteQualityNotes,
    Notes: notes.concat(triggers).join(" "),
    Decision: decision,
    "Human Review Trigger": triggers.length > 0 ? triggers.join("; ") : "None",
    Score: score,
    "Search Query Used": serp.search_query_used,
  };
}

export const OPPORTUNITY_COLUMNS: (keyof Opportunity)[] = [
  "Client",
  "Target City",
  "Opportunity Name",
  "Domain",
  "Opportunity Type",
  "Sponsorship URL",
  "Sponsor Page URL",
  "City",
  "State",
  "Local Relevance Rating",
  "Local Relevance Notes",
  "Current Sponsors Displayed Publicly",
  "Current Sponsors Linked",
  "Link Opportunity Status",
  "Link Evidence",
  "Payment Amount",
  "Payment Type",
  "Cheapest Tier With Link",
  "Tier Name",
  "Submission Method",
  "Submission URL",
  "Contact Email",
  "Contact Person",
  "DR",
  "DA",
  "Traffic",
  "HTTPS",
  "Freshness / Site Quality Notes",
  "Notes",
  "Decision",
  "Human Review Trigger",
  "Score",
  "Search Query Used",
];
