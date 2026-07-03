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

export function classifyLocalRelevance(
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

// DR is a primary decision factor for sponsorships — weighted higher than traffic.
function siteTrustScore(metrics: AhrefsMetrics): number {
  const dr = metrics.dr;
  if (dr === null) return 5;
  if (dr >= 40) return 20;
  if (dr >= 15) return 12;
  if (dr > 0) return 6;
  return 0;
}

// Traffic is optional/secondary for sponsorships. Missing, unknown, or low
// traffic must never sink an otherwise-good opportunity, so weight is small.
function trafficScore(metrics: AhrefsMetrics): number {
  const t = metrics.organic_traffic;
  if (t === null) return 1;
  if (t >= 1000) return 3;
  if (t > 0) return 2;
  return 0;
}

function relevanceScore(rating: LocalRelevanceRating): number {
  if (rating === "High") return 20;
  if (rating === "Medium") return 12;
  return 0;
}

const REJECT_DOMAIN_PATTERNS =
  /ziprecruiter|indeed\.com|glassdoor|monster\.com|careerbuilder|linkedin\.com\/jobs|simplyhired|snagajob|groupon|retailmenot|coupon|dealspotr|honey\.com/i;

const REJECT_CONTENT_PATTERNS =
  /job (listing|posting|opening)|now hiring|apply for this job|career opportunities|coupon code|promo code|discount code/i;

const SENSITIVE_CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["religious organization", /\bchurch(es)?\b|\bmosque(s)?\b|\bsynagogue(s)?\b|\btemple(s)?\b|\bministry\b|\bministries\b|\bparish\b|\bdiocese\b|\breligious\b/i],
  ["political organization", /\bpolitical\b|\bcampaign\b|\bpac\b|\bcandidate for\b|\belection\b/i],
  ["Pride or LGBTQ-related event", /\bpride\b|\blgbtq\+?\b|\blgbt\b/i],
  ["advocacy-related sponsorship", /\badvocacy\b|\bactivis[tm]\b/i],
];

function siteLooksLegitimate(crawl: SponsorshipCrawlResult, https: boolean): boolean {
  if (!https) return false;
  const blob = `${crawl.opportunityType} ${crawl.linkEvidence} ${crawl.crawlNotes} ${crawl.sponsorshipUrl}`;
  if (REJECT_DOMAIN_PATTERNS.test(blob) || REJECT_CONTENT_PATTERNS.test(blob)) return false;
  return true;
}

function isObviousReject(serp: SerpResult, crawl: SponsorshipCrawlResult): string | null {
  const blob = `${serp.title} ${serp.url} ${crawl.opportunityType} ${crawl.crawlNotes}`;
  if (REJECT_DOMAIN_PATTERNS.test(blob)) {
    return "Rejected: job board, coupon site, or other irrelevant domain pattern detected.";
  }
  if (REJECT_CONTENT_PATTERNS.test(blob)) {
    return "Rejected: page reads as a job listing or coupon/promo page, not a sponsorship opportunity.";
  }
  return null;
}

export function detectSensitiveCategory(
  serp: SerpResult,
  crawl: SponsorshipCrawlResult,
): string | null {
  const blob = `${serp.title} ${serp.url} ${crawl.opportunityType} ${crawl.crawlNotes} ${crawl.linkEvidence}`;
  for (const [label, pattern] of SENSITIVE_CATEGORY_PATTERNS) {
    if (pattern.test(blob)) return label;
  }
  return null;
}

function buildLocation(city: string, state: string): string {
  if (city && state) return `${city}, ${state}`;
  if (state) return `${state}, statewide`;
  return city || "Unknown";
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

function paymentScore(type: PaymentType, amount: string, budget: number): number {
  let base = 8;
  if (type === "One-Time") base = 20;
  else if (type === "Annual") base = 10;
  else if (type === "Unknown") base = 8;
  else if (type === "Monthly" || type === "Recurring") base = 0;

  const parsed = parseAmount(amount);
  if (parsed !== null && typeof budget === "number") {
    if (parsed <= budget) {
      return Math.max(0, base + 5);
    }
    return Math.max(0, base - 5);
  }

  return base;
}

function parseAmount(amount: string): number | null {
  if (!amount) return null;
  // Try to extract the first currency-like number, e.g. "$1,200.00" or "1200"
  const match = amount.match(/\$?\s*([0-9,]+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return value;
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

  const legitimate = siteLooksLegitimate(crawl, https);
  const obviousReject = isObviousReject(serp, crawl);
  const sensitiveCategory = detectSensitiveCategory(serp, crawl);

  const hasLinkEvidence = crawl.linkOpportunityStatus === "Confirmed";
  const hasCostOrSubmission = crawl.paymentType !== "Unknown" || crawl.submissionMethod !== "Unknown";
  const withinBudget =
    typeof inputs.maximum_approved_budget !== "number" ||
    inputs.maximum_approved_budget <= 0 ||
    (() => {
      const match = crawl.paymentAmount.match(/\$?\s*([0-9,]+(?:\.\d+)?)/);
      if (!match) return true; // amount unknown — don't block auto-approval on this alone
      const amount = Number(match[1].replace(/,/g, ""));
      return !Number.isFinite(amount) || amount <= inputs.maximum_approved_budget;
    })();

  if (!https) {
    decision = "Reject";
    notes.push("Auto-reject: site is not HTTPS.");
  } else if (obviousReject) {
    decision = "Reject";
    notes.push(obviousReject);
  } else if (crawl.linkOpportunityStatus === "No Link Opportunity") {
    decision = "Reject";
    notes.push("No web sponsorship/link opportunity was identified.");
  } else if (
    legitimate &&
    hasLinkEvidence &&
    hasCostOrSubmission &&
    withinBudget &&
    !sensitiveCategory &&
    crawl.opportunityType !== "Unknown"
  ) {
    decision = "Approve";
  } else {
    decision = "Needs Human Review";
    if (crawl.paymentType === "Unknown") triggers.push("Payment terms unknown");
    if (crawl.paymentAmount === "Unknown") triggers.push("Package amount missing");
    if (!hasLinkEvidence) {
      if (crawl.linkOpportunityStatus === "Probable") {
        triggers.push("Sponsorship page found but no sponsor examples shown");
      } else if (crawl.linkOpportunityStatus === "Unclear") {
        triggers.push("No clear hyperlink evidence");
      } else {
        triggers.push("No clear hyperlink evidence");
      }
    }
    if (crawl.contactEmail === "") triggers.push("Contact email missing");
    if (crawl.submissionMethod === "Unknown") triggers.push("Submission method unclear");
    if (rating === "Unknown") triggers.push("Location unclear");
    if (!withinBudget) triggers.push("Package amount may exceed likely budget range — verify");
    if (metrics.dr === null) triggers.push("DR missing");
    if (!legitimate) triggers.push("Website quality uncertain");
    if (crawl.opportunityType === "Unknown") triggers.push("Sponsorship availability unclear");
    if (sensitiveCategory) {
      triggers.push(`Sensitive category detected: ${sensitiveCategory}`);
      triggers.push("Client approval recommended before purchase.");
    }
    if (triggers.length === 0) triggers.push("Page may be outdated — verify details before purchase");
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

  const nowIso = new Date().toISOString();

  return {
    Client: inputs.client_business_name || "",
    "Target City": serp.target_city,
    "Opportunity Name": serp.title || serp.root_domain,
    Domain: serp.root_domain,
    "Opportunity Type": crawl.opportunityType,
    "Sponsorship URL": crawl.sponsorshipUrl || serp.url,
    "Sponsor Page URL": crawl.sponsorPageUrl,
    City: crawl.city,
    State: crawl.state || serp.target_state,
    Location: buildLocation(crawl.city, crawl.state || serp.target_state),
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
    Notes: notes.join(" "),
    Decision: decision,
    "Human Review Trigger": triggers.length > 0 ? triggers.join("; ") : "None",
    Score: score,
    "Search Query Used": serp.search_query_used,
    "Last Checked": nowIso,
    "Last Refreshed": nowIso,
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
  "Location",
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
  "Last Checked",
  "Last Refreshed",
];
