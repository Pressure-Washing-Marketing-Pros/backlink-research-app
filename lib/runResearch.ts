import "server-only";
import { domainMetricsBatch } from "@/lib/ahrefs";
import {
  buildOpportunity,
  classifyLocalRelevance,
  detectSensitiveCategory,
  isHttps,
} from "@/lib/decision";
import { serpQuery } from "@/lib/dataforseo";
import {
  classifyOpportunityType,
  findEmails,
  parsePaymentType,
} from "@/lib/crawl";
import { analyzeWithClaude } from "@/lib/claude-scraper";
import { createScraper, getConfig } from "@/lib/scrape-strategy";
import {
  PAGE_PURPOSE_SCORE_CAPS,
  analyzeContent,
  classifyPagePurpose,
  decideStatus,
  preFilterSerpResult,
  type ContentAnalysis,
  type StrictDecision,
} from "@/lib/pageAnalysis";
import { normalizeUrl } from "@/lib/urlNormalize";
import { resolveLocation } from "@/lib/locationResolve";
import {
  getCachedCrawls,
  upsertCrawlCache,
  type CrawlCacheEntry,
} from "@/lib/db";
import {
  DEFAULT_CLIENT_BUDGET,
  DR_MINIMUM,
  isCrawlCacheFresh,
} from "@/lib/sponsorshipConfig";
import { renderQueries, validateInputs } from "@/lib/queryBank";
import type {
  AhrefsMetrics,
  ApprovalStatus,
  ClientInputs,
  Decision,
  Opportunity,
  PageAnalysis,
  PagePurpose,
  QueryScope,
  RenderedQuery,
  RunResult,
  SerpResult,
  SponsorshipCrawlResult,
  ValidationError,
} from "@/lib/types";

const DEFAULT_MAX_CANDIDATES_PER_QUERY = 8;
const DEFAULT_SERP_CONCURRENCY = 2;
// Kept low — Ahrefs rate-limits hard (HTTP 429) at higher parallelism.
const DEFAULT_AHREFS_CONCURRENCY = 1;
const SCRAPED_TEXT_PREVIEW_CHARS = 2000;
const DEFAULT_SCRAPE_URL_TIMEOUT_MS = 8000;
const CLAUDE_ASSIST_TIMEOUT_MS = 12000;
const DEFAULT_MAX_CLAUDE_ASSISTS_PER_RUN = 3;
const DEFAULT_MAX_QUERIES_PER_RUN = 6;

function maxQueriesPerRun(): number {
  const raw = Number(process.env.MAX_QUERIES_PER_RUN);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_QUERIES_PER_RUN;
}

function maxCandidatesPerQuery(): number {
  const raw = Number(process.env.MAX_CANDIDATES_PER_QUERY);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MAX_CANDIDATES_PER_QUERY;
}

function serpConcurrency(): number {
  const raw = Number(process.env.SERP_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_SERP_CONCURRENCY;
}

function ahrefsConcurrency(): number {
  const raw = Number(process.env.AHREFS_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_AHREFS_CONCURRENCY;
}

function scrapeUrlTimeoutMs(): number {
  const raw = Number(process.env.SCRAPE_URL_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_SCRAPE_URL_TIMEOUT_MS;
}

function scrapeWhenDrUnavailable(): boolean {
  const raw = process.env.SCRAPE_WHEN_DR_UNAVAILABLE?.toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
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
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
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

interface Candidate {
  serp: SerpResult;
  key: string;
  fetchUrl: string;
  /** Query bucket that produced the kept SERP result for this candidate. */
  scope: QueryScope;
  /** Every query bucket (city/county/state) this domain surfaced under, this run. */
  sourceScopes: QueryScope[];
}

// A single run's cap is spread evenly across whichever scopes (city/county/
// state) actually have queries this run, so a state-heavy query bank never
// crowds out the city/county buckets before they get a turn.
function capQueriesPerScope(queries: RenderedQuery[], totalCap: number): RenderedQuery[] {
  const scopes = Array.from(new Set(queries.map((q) => q.scope)));
  if (scopes.length === 0) return [];
  const perScope = Math.max(1, Math.floor(totalCap / scopes.length));
  const out: RenderedQuery[] = [];
  for (const scope of scopes) {
    out.push(...queries.filter((q) => q.scope === scope).slice(0, perScope));
  }
  return out;
}

interface ScrapeOutcome {
  candidate: Candidate;
  scraped: boolean;
  fromCache: boolean;
  text: string;
  title: string;
  finalUrl: string;
  error?: string;
}

interface ClaudeAssistConfig {
  enabled: boolean;
  maxPerRun: number;
}

function getClaudeAssistConfig(): ClaudeAssistConfig {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  const env = process.env.CLAUDE_ASSIST_ANALYSIS?.toLowerCase();
  const enabledByFlag = env ? env === "1" || env === "true" || env === "yes" : true;
  const rawMax = Number(process.env.CLAUDE_ASSIST_ANALYSIS_MAX_URLS_PER_RUN);
  const maxPerRun = Number.isFinite(rawMax) && rawMax > 0
    ? Math.floor(rawMax)
    : DEFAULT_MAX_CLAUDE_ASSISTS_PER_RUN;
  return { enabled: hasKey && enabledByFlag, maxPerRun };
}

function parseFirstDollarAmount(amount: string | undefined): number | null {
  if (!amount) return null;
  const m = amount.match(/\$?\s*([0-9,]+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function mapClaudeOpportunityTypeToPagePurpose(
  value: string | undefined,
): PagePurpose | null {
  switch (value) {
    case "SponsorshipOpportunityPage":
    case "SponsorPacketOrForm":
    case "DonationOrPartnerPage":
    case "VendorOrExhibitorOpportunityPage":
      return value;
    case "Unknown":
      return "Unknown";
    default:
      return null;
  }
}

const EMPTY_CONTENT: ContentAnalysis = {
  sponsorshipTerms: [],
  backlinkTerms: [],
  pricingTerms: [],
  prices: [],
  lowestPrice: null,
};

// A fresh object per call (not a shared constant) so `checkedAt` reflects
// when each never-looked-up candidate was actually skipped.
function nullMetrics(): AhrefsMetrics {
  return {
    dr: null,
    organic_traffic: null,
    referring_domains: null,
    status: "failed",
    errorCategory: undefined,
    checkedAt: new Date().toISOString(),
    targetUsed: "",
    error: "Ahrefs was never called for this candidate (filtered out before the DR lookup step)",
  };
}

const AHREFS_ERROR_CATEGORY_LABEL: Record<string, string> = {
  api_key_missing: "the Ahrefs API key is missing or empty in this environment",
  rate_limited: "Ahrefs rate-limited the request",
  invalid_domain: "an invalid domain was sent to Ahrefs",
  request_failed: "the Ahrefs request failed",
  response_mapping_failed: "the Ahrefs response could not be parsed",
  no_data_returned: "Ahrefs returned no data for this domain",
};

// Turns AhrefsMetrics.error/errorCategory into a short human-readable
// fragment for the review trigger — so "DR unavailable" always says why.
function ahrefsErrorReason(metrics: AhrefsMetrics): string | undefined {
  if (metrics.dr !== null) return undefined;
  if (metrics.errorCategory && AHREFS_ERROR_CATEGORY_LABEL[metrics.errorCategory]) {
    return AHREFS_ERROR_CATEGORY_LABEL[metrics.errorCategory];
  }
  return metrics.error;
}

const DECISION_BY_STATUS: Record<ApprovalStatus, Decision> = {
  approved: "Approve",
  review: "Needs Human Review",
  rejected: "Reject",
};

function unscrapedCrawl(
  serp: SerpResult,
  note: string,
  linkStatus: SponsorshipCrawlResult["linkOpportunityStatus"] = "Unknown",
): SponsorshipCrawlResult {
  return {
    sponsorshipUrl: serp.url,
    sponsorPageUrl: "",
    opportunityType: "Unknown",
    city: "",
    state: "",
    currentSponsorsDisplayedPublicly: "Unknown",
    currentSponsorsLinked: "Unknown",
    linkOpportunityStatus: linkStatus,
    linkEvidence: "",
    paymentAmount: "Unknown",
    paymentType: "Unknown",
    cheapestTierWithLink: "Unknown",
    tierName: "Unknown",
    submissionMethod: "Unknown",
    submissionUrl: "",
    contactEmail: "",
    contactPerson: "",
    freshnessSiteQualityNotes: "",
    crawlNotes: note,
  };
}

// Maps the strict content analysis onto the SponsorshipCrawlResult shape the
// existing decision/opportunity code expects.
function crawlFromScrape(
  out: ScrapeOutcome,
  inputs: ClientInputs,
  content: ContentAnalysis,
): SponsorshipCrawlResult {
  const text = out.text;
  const lower = text.toLowerCase();
  const city =
    [inputs.client_primary_city, ...(inputs.service_area_cities ?? [])].find(
      (t) => t && lower.includes(t.toLowerCase()),
    ) ?? "";
  const state =
    [inputs.client_state, inputs.state_abbrev ?? ""].find(
      (t) => t && lower.includes(t.toLowerCase()),
    ) ?? "";
  const emails = findEmails(text);
  const url = out.finalUrl || out.candidate.serp.url;

  return {
    sponsorshipUrl: url,
    sponsorPageUrl: url,
    opportunityType: classifyOpportunityType(
      `${out.title} ${text.slice(0, 5000)} ${url}`,
    ),
    city,
    state,
    currentSponsorsDisplayedPublicly:
      content.sponsorshipTerms.length > 0 ? "Yes" : "Unknown",
    currentSponsorsLinked: "Unknown",
    linkOpportunityStatus:
      content.backlinkTerms.length > 0
        ? "Confirmed"
        : content.sponsorshipTerms.length > 0
          ? "Unclear"
          : "No Link Opportunity",
    linkEvidence:
      content.backlinkTerms.length > 0
        ? `Scraped page mentions: ${content.backlinkTerms.slice(0, 5).join(", ")}.`
        : content.sponsorshipTerms.length > 0
          ? "Sponsorship language found in scraped content, but no explicit website-link evidence."
          : "No sponsorship evidence found in scraped content.",
    paymentAmount:
      content.lowestPrice !== null ? `$${content.lowestPrice}` : "Unknown",
    paymentType: parsePaymentType(text),
    cheapestTierWithLink: "Unknown",
    tierName: "Unknown",
    submissionMethod: emails.length > 0 ? "Email" : "Unknown",
    submissionUrl: emails.length > 0 ? `mailto:${emails[0]}` : "",
    contactEmail: emails[0] ?? "",
    contactPerson: "",
    freshnessSiteQualityNotes: `Scraped content: ${text.length} chars of visible content${out.fromCache ? " (from cache)" : ""}.`,
    crawlNotes: `Page content analyzed for ${url}.`,
  };
}

// Sensitive categories (religious, political, LGBTQ/Pride, advocacy) are
// never auto-approved even when all strict criteria pass — they drop to
// human review with an explicit reason.
function resolveFinal(
  serp: SerpResult,
  crawl: SponsorshipCrawlResult,
  strict: StrictDecision,
): { status: ApprovalStatus; reason: string; category: StrictDecision["rejectionCategory"] } {
  if (strict.approvalStatus !== "approved") {
    return {
      status: strict.approvalStatus,
      reason: strict.approvalReason,
      category: strict.rejectionCategory,
    };
  }
  const sensitive = detectSensitiveCategory(serp, crawl);
  if (sensitive) {
    return {
      status: "review",
      reason: `Review: sensitive category detected (${sensitive}) — client approval recommended before purchase. ${strict.approvalReason}`,
      category: null,
    };
  }
  return { status: "approved", reason: strict.approvalReason, category: null };
}

interface RowArgs {
  serp: SerpResult;
  inputs: ClientInputs;
  metrics: AhrefsMetrics;
  crawl: SponsorshipCrawlResult;
  strict: StrictDecision;
  queryScope: QueryScope;
  sourceScopes: QueryScope[];
  scrapedText: string;
  analysisBase: Omit<
    PageAnalysis,
    "approvalStatus" | "approvalReason" | "analyzedAt" | "withinBudget" | "rejectionCategory"
  >;
}

function buildRow(args: RowArgs): Opportunity {
  const { serp, inputs, metrics, crawl, strict, queryScope, sourceScopes, scrapedText } = args;
  const final = resolveFinal(serp, crawl, strict);
  const opp = buildOpportunity({ serp, inputs, metrics, crawl });
  const decision = DECISION_BY_STATUS[final.status];

  // The strict scraped-content verdict is authoritative over the softer
  // heuristics in buildOpportunity.
  opp.Decision = decision;
  opp["Human Review Trigger"] = decision === "Approve" ? "None" : final.reason;
  opp.Notes = `${final.reason} ${opp.Notes}`.trim();

  // Non-opportunity page purposes never rank high, whatever their DR.
  const cap = PAGE_PURPOSE_SCORE_CAPS[args.analysisBase.pagePurpose] ?? 100;
  opp.Score = Math.min(opp.Score, cap);

  // The final location is resolved from what the page itself says — never
  // just defaulted to the query bucket (city/county/state) that found it.
  const location = resolveLocation({
    sourceScope: queryScope,
    title: args.analysisBase.pageTitle || serp.title,
    url: args.analysisBase.finalUrl || serp.url,
    domain: args.analysisBase.domain,
    scrapedText,
    inputs,
  });
  opp.City = location.city;
  opp.County = location.county;
  opp.State = location.state || opp.State;
  opp.Location = location.label;
  opp["Resolved Location Scope"] = location.scope;
  opp["Location Confidence"] = location.confidence;
  opp["Location Evidence"] = location.evidence;
  opp["Source Query Scopes"] = sourceScopes.join(", ");

  // An otherwise-approvable opportunity with no resolvable location still
  // needs a human to confirm where it actually applies.
  if (location.scope === "unclear" && decision === "Approve") {
    opp.Decision = "Needs Human Review";
    opp["Human Review Trigger"] =
      opp["Human Review Trigger"] === "None" ? "Location unclear" : `${opp["Human Review Trigger"]}; Location unclear`;
  }

  if (opp.Decision === "Reject") opp.Score = 0;

  opp._analysis = {
    ...args.analysisBase,
    withinBudget: strict.withinBudget,
    rejectionCategory: final.category,
    approvalStatus: final.status,
    approvalReason: final.reason,
    analyzedAt: new Date().toISOString(),
  };
  return opp;
}

export async function runResearch(
  rawInputs: Partial<ClientInputs>,
): Promise<RunResult | ValidationError> {
  const validation = validateInputs(rawInputs);
  if (!validation.ok) {
    return { status: "Missing Required Inputs", missing_fields: validation.missing };
  }
  const inputs = validation.inputs;
  const budget =
    inputs.maximum_approved_budget > 0
      ? inputs.maximum_approved_budget
      : DEFAULT_CLIENT_BUDGET;

  // Initialize scraper strategy
  const config = getConfig();
  const scraper = await createScraper(config.strategy);
  const claudeAssist = getClaudeAssistConfig();
  const maxDepth = maxCandidatesPerQuery();
  const serpConc = serpConcurrency();
  const ahrefsConc = ahrefsConcurrency();
  const scrapeTimeoutMs = scrapeUrlTimeoutMs();
  log(`Using scraper: ${scraper.name} (strategy: ${config.strategy})`);
  const SCRAPE_CONCURRENCY = config.concurrency;

  const allQueries = renderQueries(inputs);
  const queryCap = maxQueriesPerRun();
  const queries = capQueriesPerScope(allQueries, queryCap);
  if (allQueries.length > queries.length) {
    log(`Query cap (${queryCap}) active — using ${queries.length}/${allQueries.length} queries this run`);
  }
  const scopeBreakdown = queries.reduce<Record<string, number>>((acc, q) => {
    acc[q.scope] = (acc[q.scope] ?? 0) + 1;
    return acc;
  }, {});
  log(`Query scopes this run: ${JSON.stringify(scopeBreakdown)}`);

  // 1. DataForSEO SERP results
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
      console.error(`SERP query failed: ${q.query}`, e);
      return [] as SerpResult[];
    }
  });
  const allResults = serpBatches.flat();
  log(`DataForSEO returned ${allResults.length} result URLs from ${queries.length} queries`);

  // Track every scope a domain surfaced under this run, before per-domain
  // reduction collapses to one representative result — so a domain found via
  // both a city and a state query keeps both scopes on its final record.
  const scopesByDomain = new Map<string, Set<QueryScope>>();
  for (const r of allResults) {
    if (!r.root_domain) continue;
    const set = scopesByDomain.get(r.root_domain) ?? new Set<QueryScope>();
    set.add(r.query_scope ?? "state");
    scopesByDomain.set(r.root_domain, set);
  }

  // 2. Normalize + deduplicate before any paid lookups
  const perDomain = pickBestResultPerDomain(allResults);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const r of perDomain) {
    const norm = normalizeUrl(r.url);
    if (!norm || seen.has(norm.key)) continue;
    seen.add(norm.key);
    const sourceScopes = Array.from(scopesByDomain.get(r.root_domain) ?? [r.query_scope ?? "state"]);
    candidates.push({
      serp: r,
      key: norm.key,
      fetchUrl: norm.fetchUrl,
      scope: r.query_scope ?? "state",
      sourceScopes,
    });
  }
  log(`${candidates.length} candidates after domain + URL deduplication`);

  // 3. Pre-filter on URL/title/snippet/domain — social, travel, blogs, jobs,
  //    forums, tickets etc. are hard-rejected before Ahrefs or Firecrawl.
  const nonHttps: Candidate[] = [];
  const prefiltered: Array<{ candidate: Candidate; reason: string; category: StrictDecision["rejectionCategory"] }> = [];
  const clean: Candidate[] = [];
  for (const c of candidates) {
    if (!isHttps(c.serp.url)) {
      nonHttps.push(c);
      continue;
    }
    const pf = preFilterSerpResult({
      url: c.serp.url,
      title: c.serp.title,
      snippet: c.serp.snippet,
      domain: c.serp.root_domain,
    });
    if (!pf.pass) {
      prefiltered.push({ candidate: c, reason: pf.reason, category: pf.category });
    } else {
      clean.push(c);
    }
  }
  log(`Pre-filter: ${prefiltered.length} rejected (never sponsorship opportunities), ${clean.length} continue to Ahrefs`);

  // 4. Ahrefs DR gate — before Firecrawl, to save scrape credits
  const uniqueDomains = Array.from(new Set(clean.map((c) => c.serp.root_domain)));
  const metricsMap = await domainMetricsBatch(uniqueDomains, ahrefsConc);
  const metricsFor = (c: Candidate): AhrefsMetrics =>
    metricsMap.get(c.serp.root_domain) ?? nullMetrics();

  const passedDr: Candidate[] = [];
  const belowDr: Candidate[] = [];
  const drUnknown: Candidate[] = [];
  for (const c of clean) {
    const dr = metricsFor(c).dr;
    if (dr === null) drUnknown.push(c);
    else if (dr < DR_MINIMUM) belowDr.push(c);
    else passedDr.push(c);
  }
  log(
    `Ahrefs DR gate: ${passedDr.length} passed (DR >= ${DR_MINIMUM}), ${belowDr.length} rejected below threshold, ${drUnknown.length} DR unavailable (review, not scraped)`,
  );

  // 5. Per-run scrape cap — highest DR first; optional DR-unknown scraping
  const allowDrUnknownScrape = scrapeWhenDrUnavailable();
  const scrapePool = [...passedDr, ...(allowDrUnknownScrape ? drUnknown : [])];
  scrapePool.sort((a, b) => (metricsFor(b).dr ?? -1) - (metricsFor(a).dr ?? -1));
  const cap = config.maxUrlsPerRun;
  const toScrape = scrapePool.slice(0, cap);
  const overCap = scrapePool.slice(cap);
  if (overCap.length > 0) {
    log(`Per-run scrape cap (${cap}) reached — ${overCap.length} qualified URLs marked for review without scraping`);
  }

  // 6. Cache lookup (degrades gracefully if the DB is unavailable)
  let cacheMap = new Map<string, CrawlCacheEntry>();
  try {
    cacheMap = await getCachedCrawls(toScrape.map((c) => c.key));
  } catch (e) {
    log(`Crawl cache unavailable (${e instanceof Error ? e.message : "error"}) — proceeding without cache`);
  }

  // 7. Firecrawl scrape at free-plan concurrency, one retry, cache writes
  const nowSec = Math.floor(Date.now() / 1000);
  let cacheHits = 0;
  let scrapeOk = 0;
  let scrapeFail = 0;
  const outcomes = await runWithConcurrency(
    toScrape,
    SCRAPE_CONCURRENCY,
    async (c): Promise<ScrapeOutcome> => {
      const cached = cacheMap.get(c.key);
      if (cached && isCrawlCacheFresh(cached, nowSec)) {
        cacheHits++;
        return {
          candidate: c,
          scraped: cached.status === "success",
          fromCache: true,
          text: cached.scraped_text ?? "",
          title: cached.page_title ?? "",
          finalUrl: cached.final_url || c.fetchUrl,
          error: cached.error ?? undefined,
        };
      }

      const res = await withTimeout(
        scraper.scrapeUrl(c.fetchUrl),
        scrapeTimeoutMs,
        `Scrape timeout after ${Math.round(scrapeTimeoutMs / 1000)}s`,
      ).catch((e: Error) => ({
        ok: false,
        status: 0,
        pageTitle: "",
        finalUrl: c.fetchUrl,
        markdown: "",
        error: e.message,
        cacheable: false,
      }));
      if (res.ok) scrapeOk++;
      else scrapeFail++;

      if (res.cacheable) {
        try {
          await upsertCrawlCache({
            normalized_url: c.key,
            source_url: c.serp.url,
            final_url: res.finalUrl || c.fetchUrl,
            page_title: res.pageTitle,
            scraped_text: res.markdown,
            status: res.ok ? "success" : "failed",
            error: res.error ?? null,
            fetched_at: nowSec,
          });
        } catch {
          // cache write failures are non-fatal
        }
      }

      return {
        candidate: c,
        scraped: res.ok,
        fromCache: false,
        text: res.markdown,
        title: res.pageTitle,
        finalUrl: res.finalUrl || c.fetchUrl,
        error: res.error,
      };
    },
  );
  log(`${scraper.name}: ${scrapeOk} scraped, ${scrapeFail} failed, ${cacheHits} served from cache`);

  // 8. Page-purpose classification + strict analysis → opportunities
  const opportunities: Opportunity[] = [];
  let claudeAssistUsed = 0;
  let claudeAssistApplied = 0;

  for (const out of outcomes) {
    const metrics = metricsFor(out.candidate);
    const content = analyzeContent(out.text);
    const enrichedContent: ContentAnalysis = {
      sponsorshipTerms: [...content.sponsorshipTerms],
      backlinkTerms: [...content.backlinkTerms],
      pricingTerms: [...content.pricingTerms],
      prices: [...content.prices],
      lowestPrice: content.lowestPrice,
    };
    const firecrawlStatus = !out.scraped
      ? ("failed" as const)
      : out.fromCache
        ? ("cached" as const)
        : ("success" as const);
    let pagePurpose = classifyPagePurpose(
      out.finalUrl || out.candidate.serp.url,
      out.title || out.candidate.serp.title,
      out.text,
    );
    let claudeSupplemental = await (async () => {
      if (!out.scraped || !claudeAssist.enabled || claudeAssistUsed >= claudeAssist.maxPerRun) {
        return null;
      }
      if (!out.text || out.text.length < 200) return null;
      claudeAssistUsed++;
      return withTimeout(
        analyzeWithClaude(
          out.finalUrl || out.candidate.serp.url,
          out.title || out.candidate.serp.title,
          out.text,
        ),
        CLAUDE_ASSIST_TIMEOUT_MS,
        `Claude assist timeout after ${Math.round(CLAUDE_ASSIST_TIMEOUT_MS / 1000)}s`,
      ).catch(() => null);
    })();

    if (claudeSupplemental) {
      const cPagePurpose = mapClaudeOpportunityTypeToPagePurpose(claudeSupplemental.opportunityType);
      if (
        cPagePurpose &&
        (pagePurpose === "Unknown" ||
          pagePurpose === "GenericEventPage" ||
          pagePurpose === "CurrentSponsorsOnlyPage")
      ) {
        pagePurpose = cPagePurpose;
      }

      if (
        enrichedContent.sponsorshipTerms.length === 0 &&
        claudeSupplemental.opportunityType &&
        claudeSupplemental.opportunityType !== "Unknown"
      ) {
        enrichedContent.sponsorshipTerms.push("claude-opportunity-signal");
      }

      if (
        enrichedContent.backlinkTerms.length === 0 &&
        (claudeSupplemental.linkOpportunityStatus === "Confirmed" ||
          claudeSupplemental.linkOpportunityStatus === "Probable" ||
          !!claudeSupplemental.linkEvidence)
      ) {
        enrichedContent.backlinkTerms.push("claude-link-evidence");
      }

      const claudePrice = parseFirstDollarAmount(claudeSupplemental.paymentAmount);
      if (claudePrice !== null) {
        if (!enrichedContent.prices.includes(claudePrice)) {
          enrichedContent.prices.push(claudePrice);
          enrichedContent.prices.sort((a, b) => a - b);
        }
        if (enrichedContent.lowestPrice === null || claudePrice < enrichedContent.lowestPrice) {
          enrichedContent.lowestPrice = claudePrice;
        }
      }

      claudeAssistApplied++;
    }

    const { rating: localRelevance } = classifyLocalRelevance(out.candidate.serp, inputs);
    const strict = decideStatus({
      dr: metrics.dr,
      budget,
      firecrawlStatus,
      contentLength: out.text.length,
      pagePurpose,
      localRelevance,
      ahrefsErrorReason: ahrefsErrorReason(metrics),
      ...enrichedContent,
    });
    const crawl = crawlFromScrape(out, inputs, enrichedContent);
    if (claudeSupplemental) {
      if (claudeSupplemental.opportunityType) {
        crawl.opportunityType = claudeSupplemental.opportunityType;
      }
      if (claudeSupplemental.linkOpportunityStatus) {
        crawl.linkOpportunityStatus = claudeSupplemental.linkOpportunityStatus;
      }
      if (claudeSupplemental.linkEvidence) {
        crawl.linkEvidence = claudeSupplemental.linkEvidence;
      }
      if (claudeSupplemental.paymentAmount) {
        crawl.paymentAmount = claudeSupplemental.paymentAmount;
      }
      if (claudeSupplemental.paymentType) {
        crawl.paymentType = claudeSupplemental.paymentType;
      }
      if (claudeSupplemental.currentSponsorsDisplayedPublicly) {
        crawl.currentSponsorsDisplayedPublicly = claudeSupplemental.currentSponsorsDisplayedPublicly;
      }
      if (claudeSupplemental.currentSponsorsLinked) {
        crawl.currentSponsorsLinked = claudeSupplemental.currentSponsorsLinked;
      }
      crawl.crawlNotes = `${crawl.crawlNotes} Claude assist applied.`.trim();
    }
    opportunities.push(
      buildRow({
        serp: out.candidate.serp,
        inputs,
        metrics,
        crawl,
        strict,
        queryScope: out.candidate.scope,
        sourceScopes: out.candidate.sourceScopes,
        scrapedText: out.text,
        analysisBase: {
          normalizedUrl: out.candidate.key,
          sourceUrl: out.candidate.serp.url,
          finalUrl: out.finalUrl || out.candidate.serp.url,
          domain: out.candidate.serp.root_domain,
          ahrefsDR: metrics.dr,
          firecrawlStatus,
          pageTitle: out.title,
          scrapedText: out.text.slice(0, SCRAPED_TEXT_PREVIEW_CHARS),
          matchedSponsorshipTerms: enrichedContent.sponsorshipTerms,
          matchedBacklinkTerms: enrichedContent.backlinkTerms,
          matchedPricingTerms: enrichedContent.pricingTerms,
          detectedPrices: enrichedContent.prices,
          lowestDetectedPrice: enrichedContent.lowestPrice,
          pagePurpose,
          crawlCached: out.fromCache,
        },
      }),
    );
  }

  if (claudeAssist.enabled) {
    log(`Claude assist: ${claudeAssistApplied}/${claudeAssistUsed} analyzed pages applied (max ${claudeAssist.maxPerRun})`);
  }

  // 9. Non-scraped groups still get rows so nothing silently disappears
  const pushUnscraped = (
    c: Candidate,
    metrics: AhrefsMetrics,
    strict: StrictDecision,
    crawl: SponsorshipCrawlResult,
    pagePurpose: PagePurpose,
  ): void => {
    opportunities.push(
      buildRow({
        serp: c.serp,
        inputs,
        metrics,
        crawl,
        strict,
        queryScope: c.scope,
        sourceScopes: c.sourceScopes,
        scrapedText: "",
        analysisBase: {
          normalizedUrl: c.key,
          sourceUrl: c.serp.url,
          finalUrl: c.fetchUrl,
          domain: c.serp.root_domain,
          ahrefsDR: metrics.dr,
          firecrawlStatus: "skipped",
          pageTitle: c.serp.title,
          scrapedText: "",
          matchedSponsorshipTerms: [],
          matchedBacklinkTerms: [],
          matchedPricingTerms: [],
          detectedPrices: [],
          lowestDetectedPrice: null,
          pagePurpose,
          crawlCached: false,
        },
      }),
    );
  };

  // URL/title-only purpose guess for rows that were never scraped
  const purposeOf = (c: Candidate): PagePurpose =>
    classifyPagePurpose(c.serp.url, c.serp.title, "");

  const baseStrictInput = {
    budget,
    contentLength: 0,
    firecrawlStatus: "skipped" as const,
    ...EMPTY_CONTENT,
  };
  for (const { candidate: c, reason, category } of prefiltered) {
    pushUnscraped(
      c,
      nullMetrics(),
      {
        approvalStatus: "rejected",
        approvalReason: `Rejected: ${reason}.`,
        withinBudget: null,
        rejectionCategory: category,
      },
      unscrapedCrawl(c.serp, `Pre-filtered before any API spend: ${reason}.`, "No Link Opportunity"),
      purposeOf(c),
    );
  }
  const scrapedOrCappedKeys = new Set<string>([...toScrape, ...overCap].map((c) => c.key));

  for (const c of overCap) {
    const metrics = metricsFor(c);
    const { rating } = classifyLocalRelevance(c.serp, inputs);
    pushUnscraped(
      c,
      metrics,
      decideStatus({
        ...baseStrictInput,
        dr: metrics.dr,
        pagePurpose: purposeOf(c),
        localRelevance: rating,
        ahrefsErrorReason: ahrefsErrorReason(metrics),
      }),
      unscrapedCrawl(c.serp, "Not scraped this run: per-run Firecrawl cap reached."),
      purposeOf(c),
    );
  }
  for (const c of drUnknown) {
    if (scrapedOrCappedKeys.has(c.key)) continue;
    const metrics = metricsFor(c);
    const { rating } = classifyLocalRelevance(c.serp, inputs);
    pushUnscraped(
      c,
      metrics,
      decideStatus({
        ...baseStrictInput,
        dr: null,
        pagePurpose: purposeOf(c),
        localRelevance: rating,
        ahrefsErrorReason: ahrefsErrorReason(metrics),
      }),
      unscrapedCrawl(
        c.serp,
        allowDrUnknownScrape
          ? "Not scraped this run: per-run scrape cap reached before DR-unavailable candidates."
          : "Not scraped: Ahrefs DR unavailable.",
      ),
      purposeOf(c),
    );
  }
  for (const c of belowDr) {
    const metrics = metricsFor(c);
    const { rating } = classifyLocalRelevance(c.serp, inputs);
    pushUnscraped(
      c,
      metrics,
      decideStatus({
        ...baseStrictInput,
        dr: metrics.dr,
        pagePurpose: purposeOf(c),
        localRelevance: rating,
        ahrefsErrorReason: ahrefsErrorReason(metrics),
      }),
      unscrapedCrawl(c.serp, "Not scraped: domain is below the DR threshold."),
      purposeOf(c),
    );
  }
  for (const c of nonHttps) {
    pushUnscraped(
      c,
      nullMetrics(),
      {
        approvalStatus: "rejected",
        approvalReason: "Rejected: site is not HTTPS.",
        withinBudget: null,
        rejectionCategory: "Unknown",
      },
      unscrapedCrawl(c.serp, "Non-HTTPS candidate skipped.", "No Link Opportunity"),
      purposeOf(c),
    );
  }

  opportunities.sort((a, b) => b.Score - a.Score);

  const approved = opportunities.filter((o) => o.Decision === "Approve").length;
  const review = opportunities.filter((o) => o.Decision === "Needs Human Review").length;
  const rejected = opportunities.filter((o) => o.Decision === "Reject").length;
  log(`Decisions: ${approved} approved, ${review} needs review, ${rejected} rejected`);

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
        non_https: nonHttps.length,
        prefilter_rejected: prefiltered.length,
        dr_passed: passedDr.length,
        dr_rejected: belowDr.length,
        dr_unavailable: drUnknown.length,
        firecrawl_attempted: toScrape.length - cacheHits,
        firecrawl_cached: cacheHits,
        firecrawl_succeeded: scrapeOk,
        firecrawl_failed: scrapeFail,
        over_scrape_cap: overCap.length,
        approved,
        needs_review: review,
        rejected,
      },
    },
    opportunities,
  };
}
