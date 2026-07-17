import "server-only";

import { classifyLocalRelevance } from "@/lib/decision";
import {
  contentAnalyze,
  onPageAnalyzeUrl,
  serpQuery,
  type OnPageResult,
} from "@/lib/dataforseo";
import { getExistingOpportunitySignals } from "@/lib/db";
import { renderQueries, validateInputs } from "@/lib/queryBank";
import { normalizeUrl } from "@/lib/urlNormalize";
import type {
  ClientInputs,
  Opportunity,
  PaymentType,
  QueryScope,
  RunResult,
  SerpResult,
  TechnicalStatus,
  ValidationError,
} from "@/lib/types";

const DEFAULT_MAX_CANDIDATES_PER_QUERY = 8;
const DEFAULT_SERP_CONCURRENCY = 2;
const DEFAULT_ONPAGE_CONCURRENCY = 6;
const DEFAULT_CONTENT_CONCURRENCY = 6;
const DEFAULT_ONPAGE_TIMEOUT_MS = 9_000;

function maxCandidatesPerQuery(): number {
  const raw = Number(process.env.MAX_CANDIDATES_PER_QUERY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_CANDIDATES_PER_QUERY;
}

function serpConcurrency(): number {
  const raw = Number(process.env.SERP_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_SERP_CONCURRENCY;
}

function onPageConcurrency(): number {
  const raw = Number(process.env.ONPAGE_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ONPAGE_CONCURRENCY;
}

function contentConcurrency(): number {
  const raw = Number(process.env.CONTENT_ANALYSIS_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_CONTENT_CONCURRENCY;
}

function onPageTimeoutMs(): number {
  const raw = Number(process.env.ONPAGE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ONPAGE_TIMEOUT_MS;
}

function log(message: string): void {
  console.log(`[sponsorship-research] ${message}`);
}

async function withTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function normalizeDomain(raw: string): string {
  const text = (raw || "").trim();
  if (!text) return "";
  try {
    const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const u = new URL(withScheme);
    return u.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return text
      .replace(/^https?:\/\//i, "")
      .replace(/^www\./i, "")
      .split("/")[0]
      .toLowerCase();
  }
}

function pickBestResultPerDomain(results: SerpResult[]): SerpResult[] {
  const byDomain = new Map<string, SerpResult>();
  for (const r of results) {
    if (!r.root_domain) continue;
    const existing = byDomain.get(r.root_domain);
    if (!existing) {
      byDomain.set(r.root_domain, r);
      continue;
    }
    const existingHasSponsor = /sponsor|partner|support/i.test(existing.url);
    const candidateHasSponsor = /sponsor|partner|support/i.test(r.url);
    if (candidateHasSponsor && !existingHasSponsor) {
      byDomain.set(r.root_domain, r);
      continue;
    }
    if (existingHasSponsor && !candidateHasSponsor) continue;
    if (r.rank < existing.rank) byDomain.set(r.root_domain, r);
  }
  return Array.from(byDomain.values());
}

function isRelevantSerpResult(serp: SerpResult): boolean {
  const blob = `${serp.title} ${serp.snippet} ${serp.url} ${serp.root_domain}`.toLowerCase();

  const obviousIrrelevant =
    /\bjobs?\b|\bcareers?\b|visa sponsorship|travel guide|booking|coupon|promo code|privacy policy|terms of service|login|sign in|forum|thread|search results/.test(blob)
    || /(^|\.)facebook\.com$|(^|\.)instagram\.com$|(^|\.)linkedin\.com$|(^|\.)tripadvisor\.com$|(^|\.)booking\.com$|(^|\.)expedia\.com$/.test(serp.root_domain.toLowerCase());
  if (obviousIrrelevant) return false;

  const positive =
    /sponsor|sponsorship|become a sponsor|sponsorship opportunities|sponsorship package|sponsorship levels|partner with us|community partners|corporate partners|support our event|vendor and sponsor|advertise with us|donate|race sponsor|festival sponsor|team sponsor|school sponsor|event partners/.test(blob);

  const maybeRelevant = /event|nonprofit|school|chamber|association|community|charity|festival|race|marathon|tournament/.test(blob);
  return positive || maybeRelevant;
}

function findBestSponsorshipLink(page: OnPageResult): string | null {
  const allLinks = [...page.internalLinks, ...page.externalLinks];
  const patterns = [
    /sponsor/i,
    /sponsorship/i,
    /become a sponsor/i,
    /partner/i,
    /support/i,
    /donate/i,
    /media kit/i,
    /packet/i,
    /prospectus/i,
    /vendor/i,
    /registration/i,
  ];

  for (const link of allLinks) {
    const blob = `${link.anchor} ${link.url}`.toLowerCase();
    if (patterns.some((p) => p.test(blob))) return link.url;
  }
  return null;
}

function hasFastSponsorshipSignal(page: OnPageResult): boolean {
  const blob = `${page.title}\n${page.metaDescription}\n${page.headings.join("\n")}\n${page.text}`.toLowerCase();
  if (/sponsor|sponsorship|become a sponsor|partner with us|vendor|prospectus|media kit|donate|support/i.test(blob)) {
    return true;
  }
  return findBestSponsorshipLink(page) !== null;
}

function toPricing(text: string): { amount: string; notes: string } {
  const lower = text.toLowerCase();
  if (/contact for pricing|contact us for pricing|pricing upon request/.test(lower)) {
    return { amount: "Contact for pricing", notes: "Pricing requires contacting the organization." };
  }
  if (/\bfree\b/.test(lower)) {
    return { amount: "Free", notes: "Free option mentioned on page." };
  }
  const range = text.match(/\$\s?([0-9,]+)\s*(?:-|to|–)\s*\$?\s?([0-9,]+)/i);
  if (range) {
    return { amount: `$${range[1]} - $${range[2]}`, notes: "Price range extracted from page content." };
  }
  const single = text.match(/\$\s?([0-9,]+(?:\.\d+)?)/);
  if (single) {
    return { amount: `$${single[1]}`, notes: "Single visible price extracted from page content." };
  }
  return { amount: "Unknown", notes: "No explicit pricing found." };
}

function detectLocationClassification(
  city: string,
  county: string,
  metro: string,
  state: string,
  blob: string,
): "City" | "County" | "Metro" | "Statewide" | "Regional" | "Unknown" {
  const lower = blob.toLowerCase();
  if (city && lower.includes(city.toLowerCase())) return "City";
  if (county && lower.includes(county.toLowerCase())) return "County";
  if (metro && lower.includes(metro.toLowerCase())) return "Metro";
  if (state && lower.includes(state.toLowerCase())) return "Statewide";
  return "Unknown";
}

interface Candidate {
  serp: SerpResult;
  key: string;
  fetchUrl: string;
  scope: QueryScope;
}

interface ExistingSignal {
  hasApproved: boolean;
  hasNeedsReview: boolean;
  hasRejectedInLocation: boolean;
  normalizedUrls: Set<string>;
}

function buildExistingSignalMap(
  rows: Array<{
    domain: string;
    decision: string | null;
    city: string | null;
    county: string | null;
    state: string | null;
    metro: string | null;
    normalized_url: string | null;
  }>,
  inputs: ClientInputs,
): Map<string, ExistingSignal> {
  const map = new Map<string, ExistingSignal>();
  for (const row of rows) {
    const key = row.domain;
    const signal = map.get(key) ?? {
      hasApproved: false,
      hasNeedsReview: false,
      hasRejectedInLocation: false,
      normalizedUrls: new Set<string>(),
    };
    if (row.normalized_url) signal.normalizedUrls.add(row.normalized_url);

    if (row.decision === "Approve") signal.hasApproved = true;
    if (row.decision === "Needs Human Review") signal.hasNeedsReview = true;
    if (row.decision === "Reject") {
      const sameState = !!row.state && row.state.toLowerCase() === inputs.client_state.toLowerCase();
      const sameCity = !!row.city && row.city.toLowerCase() === inputs.client_primary_city.toLowerCase();
      const sameCounty = !!inputs.county && !!row.county && row.county.toLowerCase() === inputs.county.toLowerCase();
      const sameMetro = !!inputs.metro && !!row.metro && row.metro.toLowerCase() === inputs.metro.toLowerCase();
      if (sameState && (sameCity || sameCounty || sameMetro || (!row.city && !row.county && !row.metro))) {
        signal.hasRejectedInLocation = true;
      }
    }

    map.set(key, signal);
  }
  return map;
}

function makeOpportunity(args: {
  inputs: ClientInputs;
  serp: SerpResult;
  opportunityUrl: string;
  sponsorPageUrl: string;
  sourceUrl: string;
  text: string;
  title: string;
  technicalStatus: TechnicalStatus;
  technicalNotes: string;
  hasSponsorship: boolean;
  searchQueryUsed: string;
  usedJs: boolean;
  redirected: boolean;
}): Opportunity {
  const { inputs, serp, opportunityUrl, sponsorPageUrl, sourceUrl, text, title, technicalStatus, technicalNotes, hasSponsorship, searchQueryUsed, usedJs, redirected } = args;

  const pricing = toPricing(text);
  const relevance = classifyLocalRelevance(serp, inputs);
  const locationBlob = `${title} ${text} ${opportunityUrl}`;
  const classification = detectLocationClassification(
    inputs.client_primary_city,
    inputs.county ?? "",
    inputs.metro ?? "",
    inputs.client_state,
    locationBlob,
  );

  const nowIso = new Date().toISOString();

  return {
    Client: inputs.client_business_name || "",
    "Target City": inputs.client_primary_city,
    "Opportunity Name": title || serp.title || serp.root_domain,
    Domain: normalizeDomain(serp.root_domain || opportunityUrl),
    "Opportunity Type": hasSponsorship ? "Other" : "Unknown",
    "Review Status": "Needs Review",
    "Technical Status": technicalStatus,
    "Technical Notes": technicalNotes,
    "Original Discovery URL": sourceUrl,
    "Opportunity URL": opportunityUrl,
    "Sponsorship URL": opportunityUrl,
    "Sponsor Page URL": sponsorPageUrl,
    "Event Name": "",
    City: inputs.client_primary_city,
    County: inputs.county ?? "",
    State: inputs.client_state,
    "State Abbreviation": inputs.state_abbrev ?? "",
    Metro: inputs.metro ?? "",
    Location: `${inputs.client_primary_city}, ${inputs.client_state}`,
    "Location Classification": classification,
    "Source Query Scopes": serp.query_scope ?? "state",
    "SERP Prequalification Status": "Qualified for Firecrawl",
    "Resolved Location Scope": serp.query_scope ?? "state",
    "Location Confidence": relevance.rating === "High" ? "high" : relevance.rating === "Medium" ? "medium" : "low",
    "Location Evidence": relevance.notes,
    "Local Relevance Rating": relevance.rating,
    "Local Relevance Notes": relevance.notes,
    "Current Sponsors Displayed Publicly": "Unknown",
    "Current Sponsors Linked": "Unknown",
    "Link Opportunity Status": "Unclear",
    "Link Evidence": "Manual verification required.",
    "Payment Amount": pricing.amount,
    "Pricing Notes": pricing.notes,
    "Sponsorship Tiers": "Unknown",
    "Cheapest Tier With Link": "Unknown",
    "Website Link Included": "Unknown",
    "Logo Included": "Unknown",
    "Payment Type": "Unknown" as PaymentType,
    "Payment Method": "Unknown",
    "Tier Name": "Unknown",
    "Submission Method": "Unknown",
    "Submission URL": "",
    "Contact Email": "",
    "Contact Person": "",
    "Event Date": "",
    Deadline: "",
    DR: "Unknown",
    DA: "Unknown",
    Traffic: "Unknown",
    HTTPS: "Yes",
    "Freshness / Site Quality Notes": usedJs ? "JavaScript rendering used." : "Standard crawl used.",
    Notes: redirected ? `${technicalNotes} Redirect detected during crawl.` : technicalNotes,
    Decision: "Needs Human Review",
    "Human Review Trigger": hasSponsorship ? "New discovery requires manual approval." : "No sponsorship content found; manual review required.",
    Score: relevance.rating === "High" ? 35 : relevance.rating === "Medium" ? 25 : 15,
    "Search Query Used": searchQueryUsed,
    "Last Checked": nowIso,
    "Last Refreshed": nowIso,
  };
}

export async function runResearch(
  rawInputs: Partial<ClientInputs>,
): Promise<RunResult | ValidationError> {
  const validation = validateInputs(rawInputs);
  if (!validation.ok) {
    return { status: "Missing Required Inputs", missing_fields: validation.missing };
  }
  const inputs = validation.inputs;

  const maxDepth = maxCandidatesPerQuery();
  const queries = renderQueries(inputs);

  const serpConc = serpConcurrency();
  const onPageConc = onPageConcurrency();
  const contentConc = contentConcurrency();

  const serpBatches = await runWithConcurrency(queries, serpConc, async (q) => {
    try {
      const results = await serpQuery({
        query: q.query,
        target_city: q.target_city,
        target_state: q.target_state,
        depth: maxDepth,
      });
      return results.slice(0, maxDepth).map((r) => ({ ...r, query_scope: q.scope }));
    } catch (e) {
      log(`SERP query failed: ${q.query} (${e instanceof Error ? e.message : "error"})`);
      return [] as SerpResult[];
    }
  });

  const allResults = serpBatches.flat();
  const perDomain = pickBestResultPerDomain(allResults);

  const seenUrl = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of perDomain) {
    const norm = normalizeUrl(r.url);
    if (!norm || seenUrl.has(norm.key)) continue;
    seenUrl.add(norm.key);
    candidates.push({
      serp: r,
      key: norm.key,
      fetchUrl: norm.fetchUrl,
      scope: r.query_scope ?? "state",
    });
  }

  const existingRows = await getExistingOpportunitySignals(
    candidates.map((c) => normalizeDomain(c.serp.root_domain || c.serp.url)),
  );
  const existingSignals = buildExistingSignalMap(existingRows, inputs);

  const opportunities: Opportunity[] = [];
  const processedRunUrls = new Set<string>();

  let approvedDuplicatesSkipped = 0;
  let needsReviewDuplicatesSkipped = 0;
  let rejectedDuplicatesSkipped = 0;
  let serpFilteredOut = 0;
  let onpageSent = 0;
  let onpageStandardCompleted = 0;
  let onpageJsCompleted = 0;
  let onpageFailed = 0;
  let redirectedUrls = 0;
  let postCrawlDuplicatesSkipped = 0;
  let contentAnalysisSent = 0;
  let contentAnalysisSkipped = 0;
  let sponsorshipFound = 0;
  let noSponsorshipFound = 0;
  let technicalFailuresRequiringReview = 0;

  const filteredCandidates: Candidate[] = [];
  for (const c of candidates) {
    const domain = normalizeDomain(c.serp.root_domain || c.serp.url);
    const signal = existingSignals.get(domain);
    if (signal?.hasApproved) {
      approvedDuplicatesSkipped++;
      continue;
    }
    if (signal?.hasNeedsReview) {
      needsReviewDuplicatesSkipped++;
      continue;
    }
    if (signal?.hasRejectedInLocation) {
      rejectedDuplicatesSkipped++;
      continue;
    }

    if (!isRelevantSerpResult(c.serp)) {
      serpFilteredOut++;
      continue;
    }

    filteredCandidates.push(c);
  }

  const crawled = await runWithConcurrency(filteredCandidates, onPageConc, async (c) => {
    onpageSent++;
    let page = await withTimeout(
      onPageAnalyzeUrl(c.fetchUrl, { useJavaScript: false }),
      onPageTimeoutMs(),
      `OnPage timeout for ${c.fetchUrl}`,
    ).catch((e: Error): OnPageResult => ({
      ok: false,
      sourceUrl: c.fetchUrl,
      finalUrl: c.fetchUrl,
      canonicalUrl: "",
      statusCode: null,
      title: "",
      metaDescription: "",
      headings: [],
      text: "",
      html: "",
      internalLinks: [],
      externalLinks: [],
      usedJavaScript: false,
      error: e.message,
    }));

    if (page.ok) onpageStandardCompleted++;

    const lowContent = !page.ok || (page.text || "").trim().length < 200;
    if (lowContent) {
      const jsPage = await withTimeout(
        onPageAnalyzeUrl(c.fetchUrl, { useJavaScript: true }),
        onPageTimeoutMs(),
        `OnPage JS timeout for ${c.fetchUrl}`,
      ).catch(() => null);
      if (jsPage && jsPage.ok) {
        page = jsPage;
        onpageJsCompleted++;
      }
    }

    if (!page.ok) onpageFailed++;

    if (page.ok && normalizeUrl(page.finalUrl)?.key !== normalizeUrl(c.fetchUrl)?.key) {
      redirectedUrls++;
    }

    return { c, page };
  });

  const toAnalyze = crawled.filter((item) => {
    if (!item.page.ok) {
      technicalFailuresRequiringReview++;
      opportunities.push(
        makeOpportunity({
          inputs,
          serp: item.c.serp,
          opportunityUrl: item.c.serp.url,
          sponsorPageUrl: "",
          sourceUrl: item.c.serp.url,
          text: "",
          title: item.c.serp.title,
          technicalStatus: "Crawl failed",
          technicalNotes: item.page.error || "Crawl failed. Manual review required.",
          hasSponsorship: false,
          searchQueryUsed: item.c.serp.search_query_used,
          usedJs: item.page.usedJavaScript,
          redirected: false,
        }),
      );
      return false;
    }

    const primaryNormalized = normalizeUrl(item.page.canonicalUrl || item.page.finalUrl || item.c.serp.url);
    if (primaryNormalized && processedRunUrls.has(primaryNormalized.key)) {
      postCrawlDuplicatesSkipped++;
      return false;
    }
    if (primaryNormalized) processedRunUrls.add(primaryNormalized.key);

    const domain = normalizeDomain(item.c.serp.root_domain || item.page.finalUrl);
    const signal = existingSignals.get(domain);
    if (signal && primaryNormalized && signal.normalizedUrls.has(primaryNormalized.key)) {
      postCrawlDuplicatesSkipped++;
      return false;
    }

    return true;
  });

  const analyzed = await runWithConcurrency(toAnalyze, contentConc, async (item) => {
    let workingPage = item.page;

    const betterLink = findBestSponsorshipLink(workingPage);
    if (betterLink && betterLink !== workingPage.finalUrl) {
      const better = await withTimeout(
        onPageAnalyzeUrl(betterLink, { useJavaScript: false }),
        onPageTimeoutMs(),
        `OnPage timeout for discovered sponsorship link ${betterLink}`,
      ).catch(() => null);
      if (better?.ok) {
        onpageStandardCompleted++;
        workingPage = better;
      }
    }

    const combinedText = `${workingPage.title}\n${workingPage.metaDescription}\n${workingPage.text}`;
    const fastSignal = hasFastSponsorshipSignal(workingPage);

    const contentRes = fastSignal
      ? await (async () => {
          contentAnalysisSent++;
          return contentAnalyze(
            workingPage.finalUrl,
            `${workingPage.title}\n${workingPage.metaDescription}\n${workingPage.headings.join("\n")}\n${workingPage.text}`,
          );
        })()
      : {
          ok: true,
          summary: "Skipped content analysis: no sponsorship signal from on-page quick scan.",
          sponsorshipSignals: [],
          pricingSignals: [],
          contactSignals: [],
          opportunityType: "Unknown",
          hasSponsorshipOpportunity: false,
          cheapestTierWithLink: "Unknown",
          error: undefined,
        };

    if (!fastSignal) contentAnalysisSkipped++;

    const hasSponsorship =
      contentRes.hasSponsorshipOpportunity
      || /sponsor|sponsorship|become a sponsor|partner with us|vendor|media kit|prospectus/i.test(combinedText);

    if (hasSponsorship) sponsorshipFound++;
    else noSponsorshipFound++;

    return {
      c: item.c,
      page: workingPage,
      contentRes,
      hasSponsorship,
    };
  });

  for (const item of analyzed) {
    opportunities.push(
      makeOpportunity({
        inputs,
        serp: item.c.serp,
        opportunityUrl: item.page.finalUrl || item.c.serp.url,
        sponsorPageUrl: item.page.finalUrl || item.c.serp.url,
        sourceUrl: item.c.serp.url,
        text: `${item.page.text}\n${item.contentRes.summary}`,
        title: item.page.title || item.c.serp.title,
        technicalStatus: item.hasSponsorship ? "Content analysis completed" : "No sponsorship content found",
        technicalNotes: item.contentRes.ok
          ? "DataForSEO OnPage and Content Analysis completed."
          : item.contentRes.error || "Content analysis incomplete. Manual review required.",
        hasSponsorship: item.hasSponsorship,
        searchQueryUsed: item.c.serp.search_query_used,
        usedJs: item.page.usedJavaScript,
        redirected: normalizeUrl(item.page.finalUrl)?.key !== normalizeUrl(item.c.fetchUrl)?.key,
      }),
    );
  }

  const approved = opportunities.filter((o) => o.Decision === "Approve").length;
  const review = opportunities.filter((o) => o.Decision === "Needs Human Review").length;
  const rejected = opportunities.filter((o) => o.Decision === "Reject").length;

  return {
    summary: {
      client: inputs.client_business_name || "General sponsorship research",
      target_city: inputs.client_primary_city,
      target_state: inputs.client_state,
      run_date: new Date().toISOString(),
      total_candidates_reviewed: opportunities.length,
      approved_count: approved,
      review_count: review,
      rejected_count: rejected,
      queries_used: queries.map((q) => q.query),
      pipeline_stats: {
        serp_results: allResults.length,
        after_dedup: candidates.length,
        unique_domains_found: perDomain.length,
        approved_duplicates_skipped: approvedDuplicatesSkipped,
        needs_review_duplicates_skipped: needsReviewDuplicatesSkipped,
        rejected_duplicates_skipped: rejectedDuplicatesSkipped,
        serp_filtered_out: serpFilteredOut,
        onpage_sent: onpageSent,
        onpage_standard_completed: onpageStandardCompleted,
        onpage_js_completed: onpageJsCompleted,
        onpage_failed: onpageFailed,
        redirected_urls: redirectedUrls,
        post_crawl_duplicates_skipped: postCrawlDuplicatesSkipped,
        content_analysis_sent: contentAnalysisSent,
        content_analysis_skipped: contentAnalysisSkipped,
        sponsorship_found: sponsorshipFound,
        no_sponsorship_found: noSponsorshipFound,
        new_needs_review_created: opportunities.filter((o) => o["Review Status"] === "Needs Review").length,
        technical_failures_requiring_review: technicalFailuresRequiringReview,
        approved,
        needs_review: review,
        rejected,
      },
    },
    opportunities,
  };
}
