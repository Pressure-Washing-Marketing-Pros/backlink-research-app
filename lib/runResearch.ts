import "server-only";
import { domainMetricsBatch } from "@/lib/ahrefs";
import { buildOpportunity, isHttps } from "@/lib/decision";
import { serpQuery } from "@/lib/dataforseo";
import { crawlCandidate } from "@/lib/crawl";
import { renderQueries, validateInputs } from "@/lib/queryBank";
import type {
  ClientInputs,
  Opportunity,
  RunResult,
  SerpResult,
  SponsorshipCrawlResult,
  ValidationError,
} from "@/lib/types";

const MAX_CANDIDATES_PER_QUERY = 30;
const SERP_CONCURRENCY = 3;
const AHREFS_CONCURRENCY = 5;

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

export async function runResearch(
  rawInputs: Partial<ClientInputs>,
): Promise<RunResult | ValidationError> {
  const validation = validateInputs(rawInputs);
  if (!validation.ok) {
    return { status: "Missing Required Inputs", missing_fields: validation.missing };
  }
  const inputs = validation.inputs;

  const queries = renderQueries(inputs);

  const serpBatches = await runWithConcurrency(queries, SERP_CONCURRENCY, async (q) => {
    try {
      const results = await serpQuery({
        query: q.query,
        target_city: q.target_city,
        target_state: q.target_state,
        depth: MAX_CANDIDATES_PER_QUERY,
      });
      return results.slice(0, MAX_CANDIDATES_PER_QUERY);
    } catch (e) {
      console.error(`SERP query failed: ${q.query}`, e);
      return [] as SerpResult[];
    }
  });

  const allResults = serpBatches.flat();
  const deduped = pickBestResultPerDomain(allResults);

  const httpsCandidates = deduped.filter((r) => isHttps(r.url));
  const nonHttps = deduped.filter((r) => !isHttps(r.url));

  const uniqueDomains = Array.from(new Set(httpsCandidates.map((r) => r.root_domain)));
  const metricsMap = await domainMetricsBatch(uniqueDomains, AHREFS_CONCURRENCY);

  const crawls = await runWithConcurrency(httpsCandidates, SERP_CONCURRENCY, async (r) => {
    return crawlCandidate(r.url, r.root_domain, inputs);
  });

  const opportunities: Opportunity[] = [];
  for (const [index, r] of httpsCandidates.entries()) {
    const metrics = metricsMap.get(r.root_domain) ?? {
      dr: null,
      organic_traffic: null,
      referring_domains: null,
    };
    const crawl = crawls[index];
    opportunities.push(buildOpportunity({ serp: r, inputs, metrics, crawl }));
  }

  const defaultNoHttpsCrawl: SponsorshipCrawlResult = {
    sponsorshipUrl: "",
    sponsorPageUrl: "",
    opportunityType: "Unknown",
    city: "",
    state: "",
    currentSponsorsDisplayedPublicly: "Unknown",
    currentSponsorsLinked: "Unknown",
    linkOpportunityStatus: "No Link Opportunity",
    linkEvidence: "Site is not HTTPS; auto-rejected.",
    paymentAmount: "Unknown",
    paymentType: "Unknown",
    cheapestTierWithLink: "Unknown",
    tierName: "Unknown",
    submissionMethod: "Unknown",
    submissionUrl: "",
    contactEmail: "",
    contactPerson: "",
    freshnessSiteQualityNotes: "",
    crawlNotes: "Non-HTTPS candidate skipped.",
  };

  for (const r of nonHttps) {
    opportunities.push(
      buildOpportunity({
        serp: r,
        inputs,
        metrics: { dr: null, organic_traffic: null, referring_domains: null },
        crawl: defaultNoHttpsCrawl,
      }),
    );
  }

  opportunities.sort((a, b) => b.Score - a.Score);

  const approved = opportunities.filter((o) => o.Decision === "Approve").length;
  const review = opportunities.filter((o) => o.Decision === "Needs Human Review").length;
  const rejected = opportunities.filter((o) => o.Decision === "Reject").length;

  return {
    summary: {
      client: inputs.client_business_name,
      target_city: inputs.client_primary_city,
      target_state: inputs.client_state,
      run_date: new Date().toISOString(),
      total_candidates_reviewed: opportunities.length,
      approved_count: approved,
      review_count: review,
      rejected_count: rejected,
      queries_used: queries.map((q) => q.query),
    },
    opportunities,
  };
}
