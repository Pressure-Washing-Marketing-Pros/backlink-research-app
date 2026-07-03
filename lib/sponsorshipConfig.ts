// Sponsorship research configuration: keyword groups, thresholds, and
// Firecrawl usage limits. Edit the keyword groups here to tune matching.
// Approval decisions are based on these terms appearing in SCRAPED page
// content — never on DataForSEO titles/snippets or URL text alone.
//
// This module is dependency-free and safe to import from scripts/tests
// (no "server-only", no database, no network).

// Keyword group 1: sponsorship intent terms
export const SPONSORSHIP_INTENT_TERMS: readonly string[] = [
  "sponsor",
  "sponsorship",
  "sponsors",
  "become a sponsor",
  "sponsorship opportunity",
  "sponsorship opportunities",
  "business sponsor",
  "corporate sponsor",
  "community sponsor",
  "event sponsor",
  "partner",
  "community partner",
  "supporter",
  "donor",
  "advertising",
  "advertise",
  "vendor",
  "vendor opportunity",
  "vendor booth",
  "exhibitor",
  "fundraiser",
  "donation",
];

// Keyword group 2: backlink / website link evidence terms
export const BACKLINK_EVIDENCE_TERMS: readonly string[] = [
  "website link",
  "link to your website",
  "link back to your website",
  "backlink",
  "linked logo",
  "logo link",
  "logo with link",
  "sponsor page",
  "sponsor listing",
  "online recognition",
  "website recognition",
  "online sponsor listing",
  "business listing",
  "directory listing",
  "company link",
  "link included",
  "includes link",
  "website included",
  "listed on our website",
  "featured on our website",
  "logo on our website",
  "recognition on our website",
  "sponsor logo",
  "sponsor logos",
];

// Keyword group 3: pricing and package terms
export const PRICING_TERMS: readonly string[] = [
  "$",
  "cost",
  "fee",
  "price",
  "pricing",
  "package",
  "packages",
  "sponsorship level",
  "sponsor level",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "presenting sponsor",
  "title sponsor",
  "donation amount",
  "contribution",
  "table sponsor",
  "booth fee",
];

// Minimum Ahrefs DR — checked BEFORE Firecrawl so credits are never spent on
// low-authority domains.
export const DR_MINIMUM = 25;

// Used when the run inputs don't provide a budget (maximum_approved_budget
// missing or 0).
export const DEFAULT_CLIENT_BUDGET = 300;

// Firecrawl free plan: 1,000 pages/month, 2 concurrent requests.
export const FIRECRAWL_CONCURRENCY = 2;
export const DEFAULT_MAX_FIRECRAWL_URLS_PER_RUN = 50;

// Scraped content shorter than this is treated as "too little to evaluate"
// and routed to human review rather than auto-approved or auto-rejected.
export const MIN_CONTENT_LENGTH = 200;

// Successful crawls are reused for this many days (sensible range 30–90).
export const DEFAULT_CRAWL_CACHE_TTL_DAYS = 60;
// Failures are cached too — so a broken URL is not retried repeatedly in the
// same run/day — but expire quickly so transient errors self-heal.
export const CRAWL_CACHE_FAILURE_TTL_DAYS = 1;

export function maxFirecrawlUrlsPerRun(): number {
  const raw = Number(process.env.FIRECRAWL_MAX_URLS_PER_RUN);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MAX_FIRECRAWL_URLS_PER_RUN;
}

export function crawlCacheTtlDays(): number {
  const raw = Number(process.env.CRAWL_CACHE_TTL_DAYS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CRAWL_CACHE_TTL_DAYS;
}

export function isCrawlCacheFresh(
  entry: { status: string; fetched_at: number },
  nowSeconds: number,
): boolean {
  const ttlDays =
    entry.status === "success" ? crawlCacheTtlDays() : CRAWL_CACHE_FAILURE_TTL_DAYS;
  return nowSeconds - entry.fetched_at < ttlDays * 86400;
}

// Job boards, coupon sites, and generic directories are never sponsorship
// opportunities — rejected before any Ahrefs or Firecrawl spend.
export const SPAM_DOMAIN_PATTERN =
  /ziprecruiter|indeed\.com|glassdoor|monster\.com|careerbuilder|linkedin\.com\/jobs|simplyhired|snagajob|jobtoday|salutemyjob|groupon|retailmenot|coupon|dealspotr|honey\.com|yellowpages|manta\.com|mapquest|foursquare/i;

// ---------------------------------------------------------------------------
// Strict page-purpose filtering.
//
// We are NOT looking for pages that talk about sponsorship. We are looking
// for pages where a business can actually purchase, request, or apply for
// sponsorship. If the page does not offer a sponsorship opportunity, it must
// be rejected — regardless of DR or how often it mentions "sponsor".
// ---------------------------------------------------------------------------

// Positive phrases: a scraped page must contain at least one of these to be
// classified as an actual sponsorship opportunity.
export const SPONSORSHIP_OPPORTUNITY_PHRASES: readonly string[] = [
  "become a sponsor",
  "sponsor our event",
  "sponsor this event",
  "sponsorship opportunities",
  "sponsorship packages",
  "sponsor packet",
  "sponsorship packet",
  "sponsorship form",
  "sponsor registration",
  "sponsor application",
  "sponsor levels",
  "sponsorship levels",
  "corporate sponsorship",
  "business sponsorship",
  "community sponsorship",
  "advertising opportunities",
  "become a partner",
  "partner with us",
  "vendor opportunities",
  "exhibitor opportunities",
  "support our event",
  "donate as a sponsor",
  "sponsorship includes",
  "sponsor benefits",
  "benefits include",
  "submit sponsorship",
  "contact us to sponsor",
];

// Passive sponsor mentions: only valid when opportunity phrases also appear
// on the same page — otherwise the page is a "current sponsors" list.
export const PASSIVE_SPONSOR_PHRASES: readonly string[] = [
  "our sponsors",
  "current sponsors",
  "meet our sponsors",
  "thank you to our sponsors",
  "sponsored by",
  "presented by",
  "sponsor list",
  "sponsor logos",
];

// Domains that are never sponsorship opportunities — hard rejected in the
// pre-filter, before any Ahrefs or Firecrawl spend.
export const HARD_REJECT_TRAVEL_REVIEW_PATTERN = /tripadvisor\.com|yelp\.com/i;
export const HARD_REJECT_SOCIAL_FORUM_PATTERN =
  /reddit\.com|facebook\.com|instagram\.com|linkedin\.com|youtube\.com|tiktok\.com|pinterest\.com|(^|[\s/.])x\.com|twitter\.com/i;
export const HARD_REJECT_BLOG_PLATFORM_PATTERN = /medium\.com|substack\.com/i;

// A URL/title signal strong enough to allow an /events/, /register/, or .pdf
// path through the pre-filter (e.g. "sponsorship-opportunities", "sponsor
// packet"). Dots match the -, _, %20, or space between words in URLs.
export const OPPORTUNITY_SIGNAL_PATTERN =
  /become.a.sponsor|sponsorship.opportunit|sponsor(ship)?.packet|sponsorship.package|sponsor.registration|sponsorship.form|sponsor.application|sponsorship.prospectus|sponsor(ship)?.levels?/i;
