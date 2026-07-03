// Strict, rule-based analysis of scraped sponsorship pages. Pure functions —
// no network or database access — so they are unit-testable (npm test) and
// reusable for the future citation research tool.
//
// GOVERNING RULE: we are not looking for pages that TALK ABOUT sponsorship.
// We are looking for pages where a business can actually purchase, request,
// or apply for sponsorship. If the page does not offer a sponsorship
// opportunity, reject it — regardless of DR or keyword density. Approval is
// never based on SERP titles/snippets or URL text alone.

import {
  BACKLINK_EVIDENCE_TERMS,
  DR_MINIMUM,
  HARD_REJECT_BLOG_PLATFORM_PATTERN,
  HARD_REJECT_SOCIAL_FORUM_PATTERN,
  HARD_REJECT_TRAVEL_REVIEW_PATTERN,
  MIN_CONTENT_LENGTH,
  OPPORTUNITY_SIGNAL_PATTERN,
  PASSIVE_SPONSOR_PHRASES,
  PRICING_TERMS,
  SPAM_DOMAIN_PATTERN,
  SPONSORSHIP_INTENT_TERMS,
  SPONSORSHIP_OPPORTUNITY_PHRASES,
} from "./sponsorshipConfig";
import type {
  ApprovalStatus,
  LocalRelevanceRating,
  PagePurpose,
  RejectionCategory,
} from "./types";

export function matchTerms(text: string, terms: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase()));
}

// ---------------------------------------------------------------------------
// Pre-filter: runs on URL + title + snippet + domain BEFORE Ahrefs and
// Firecrawl, so no API spend goes to results that can never be sponsorship
// opportunities (social, travel, blogs, jobs, forums, tickets...).
// ---------------------------------------------------------------------------

export interface PreFilterVerdict {
  pass: boolean;
  reason: string;
  category: RejectionCategory | null;
}

const PRE_PASS: PreFilterVerdict = { pass: true, reason: "", category: null };

export function preFilterSerpResult(input: {
  url: string;
  title: string;
  snippet?: string;
  domain: string;
}): PreFilterVerdict {
  const url = input.url.toLowerCase();
  const titleSnippet = `${input.title} ${input.snippet ?? ""}`.toLowerCase();
  const all = `${titleSnippet} ${url}`;
  const domainAndUrl = `${input.domain} ${url}`;
  const hasOpportunitySignal = OPPORTUNITY_SIGNAL_PATTERN.test(all);
  const reject = (
    reason: string,
    category: RejectionCategory,
  ): PreFilterVerdict => ({ pass: false, reason, category });

  // Domains that never host sponsorship opportunities
  if (HARD_REJECT_TRAVEL_REVIEW_PATTERN.test(domainAndUrl)) {
    return reject("travel/review site — never a sponsorship opportunity", "Travel/review result");
  }
  if (HARD_REJECT_SOCIAL_FORUM_PATTERN.test(domainAndUrl)) {
    return reject("social media or forum platform — never a sponsorship opportunity", "Forum/social result");
  }
  if (HARD_REJECT_BLOG_PLATFORM_PATTERN.test(domainAndUrl)) {
    return reject("blogging platform — article content, not a sponsorship opportunity", "Blog/article result");
  }
  if (SPAM_DOMAIN_PATTERN.test(domainAndUrl)) {
    return reject("job board, coupon site, or generic directory", "Job/visa sponsorship result");
  }

  // Title/snippet hard rejects
  if (/visa sponsorship|registered nurse/.test(titleSnippet)) {
    return reject("employment/visa sponsorship result — not event or organizational sponsorship", "Job/visa sponsorship result");
  }
  if (/\bjobs?\b|\bcareers?\b/.test(titleSnippet)) {
    return reject("job/career result", "Job/visa sponsorship result");
  }
  if (/how to get sponsors|tips from industry pros/.test(titleSnippet)) {
    return reject('"how to get sponsors" article — informational content, not an opportunity', "Blog/article result");
  }
  if (/all you must know|things to do|best places|\bvacations?\b|\btourism\b|travel guide/.test(titleSnippet)) {
    return reject("travel/tourism content", "Travel/review result");
  }
  if (/\bnews\b|people on the move/.test(titleSnippet)) {
    return reject("news content", "Blog/article result");
  }
  if (/\bforum\b|\bthreads?\b/.test(titleSnippet)) {
    return reject("forum/thread content", "Forum/social result");
  }
  if (/\breviews?\b/.test(titleSnippet)) {
    return reject("review content", "Travel/review result");
  }
  if (/\btickets?\b|buy tickets|event tickets/.test(titleSnippet)) {
    return reject("ticket sales result", "Generic event/ticket result");
  }
  if (
    /meet our sponsors|our sponsors|thank you to our sponsors|sponsor list/.test(titleSnippet) &&
    !hasOpportunitySignal
  ) {
    return reject('"our sponsors" listing with no become-a-sponsor signal', "Current sponsors only");
  }

  // URL path hard rejects (no exceptions — sponsorship pages don't live here)
  if (/\/blog\/|\/\/blog\.|\/news\/|\/articles?\/|\/press[^/]*\//.test(url)) {
    return reject("blog/news/article path", "Blog/article result");
  }
  if (/\/careers?\/|\/jobs?\//.test(url)) {
    return reject("careers/jobs path", "Job/visa sponsorship result");
  }
  if (/\/threads?\/|\/forums?\//.test(url)) {
    return reject("forum path", "Forum/social result");
  }
  if (/\/reviews?\//.test(url)) {
    return reject("reviews path", "Travel/review result");
  }
  if (/\/tourism|\/vacations?|\/things-to-do/.test(url)) {
    return reject("tourism path", "Travel/review result");
  }
  if (/\/calendar\/|\/recap\/|\/photos?\/|\/gallery\//.test(url)) {
    return reject("calendar/recap/gallery path", "Generic event/ticket result");
  }
  if (/\/tickets?\//.test(url)) {
    return reject("tickets path", "Generic event/ticket result");
  }

  // Exceptable paths: allowed only with a clear sponsorship signal
  const sponsorInUrl = /sponsor/i.test(url);
  if (/\/events?\//.test(url) && !hasOpportunitySignal && !sponsorInUrl) {
    return reject("generic event path with no sponsorship signal", "Generic event/ticket result");
  }
  if (/\/registration|\/register\b/.test(url) && !hasOpportunitySignal && !sponsorInUrl) {
    return reject("registration path with no sponsor-registration signal", "Generic event/ticket result");
  }
  if (url.includes(".pdf") && !hasOpportunitySignal && !/sponsor|packet|prospectus/.test(all)) {
    return reject("PDF with no sponsorship packet signal", "No sponsorship opportunity language");
  }

  return PRE_PASS;
}

// ---------------------------------------------------------------------------
// Page purpose classifier: runs on the SCRAPED content (plus URL/title).
// Only the four opportunity purposes are eligible for approval.
// ---------------------------------------------------------------------------

export const APPROVABLE_PAGE_PURPOSES: ReadonlySet<PagePurpose> = new Set([
  "SponsorshipOpportunityPage",
  "SponsorPacketOrForm",
  "DonationOrPartnerPage",
  "VendorOrExhibitorOpportunityPage",
]);

export function classifyPagePurpose(
  url: string,
  title: string,
  text: string,
): PagePurpose {
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  const lowerText = text.toLowerCase();
  const urlAndTitle = `${lowerUrl} ${lowerTitle}`;

  // Hard-negative types first — a forum thread quoting "become a sponsor"
  // is still a forum thread.
  if (HARD_REJECT_SOCIAL_FORUM_PATTERN.test(lowerUrl)) {
    return /reddit\.com/.test(lowerUrl) ? "ForumThread" : "SocialMediaPage";
  }
  if (/\/forums?\/|\/threads?\//.test(lowerUrl) || /\bforum\b|\bthread\b/.test(lowerTitle)) {
    return "ForumThread";
  }
  if (
    /\/jobs?\/|\/careers?\//.test(lowerUrl) ||
    /visa sponsorship|registered nurse|\bjob (listing|posting|opening)s?\b|now hiring|apply for this job/.test(
      `${urlAndTitle} ${lowerText.slice(0, 3000)}`,
    )
  ) {
    return "JobPosting";
  }
  if (
    HARD_REJECT_TRAVEL_REVIEW_PATTERN.test(lowerUrl) ||
    /\/tourism|\/vacations?|things-to-do|travel guide|all you must know/.test(urlAndTitle)
  ) {
    return "TravelOrReviewPage";
  }
  if (
    /\/blog\/|\/\/blog\./.test(lowerUrl) ||
    HARD_REJECT_BLOG_PLATFORM_PATTERN.test(lowerUrl) ||
    /how to get sponsors|tips from industry|^how to\b/.test(lowerTitle)
  ) {
    return "BlogArticle";
  }
  if (
    /\/news\/|\/articles?\/|\/press[^/]*\//.test(lowerUrl) ||
    /\bnews\b|people on the move/.test(lowerTitle)
  ) {
    return "NewsArticle";
  }

  const opportunityMatches = matchTerms(text, SPONSORSHIP_OPPORTUNITY_PHRASES);
  const hasOpportunity =
    opportunityMatches.length > 0 || OPPORTUNITY_SIGNAL_PATTERN.test(urlAndTitle);

  if (!hasOpportunity) {
    if (/\/tickets?\/|buy tickets|event tickets|\/registration|\/register\b/.test(urlAndTitle)) {
      return "TicketOrRegistrationPage";
    }
    if (/\/directory|yellowpages|business directory|\/listings?\//.test(urlAndTitle)) {
      return "DirectoryListing";
    }
    const hasPassive = PASSIVE_SPONSOR_PHRASES.some(
      (p) => lowerText.includes(p) || lowerTitle.includes(p),
    );
    if (hasPassive) return "CurrentSponsorsOnlyPage";
    if (/\/events?\/|festival|\bgala\b|\b5k\b|marathon|\bexpo\b|\bfair\b/.test(urlAndTitle)) {
      return "GenericEventPage";
    }
    return "Unknown";
  }

  // Opportunity language present — pick the subtype
  const packetSignal = /sponsor(ship)? packet|sponsorship form|sponsor application|sponsor registration|prospectus/;
  if (lowerUrl.includes(".pdf") || packetSignal.test(lowerText) || packetSignal.test(lowerTitle)) {
    return "SponsorPacketOrForm";
  }
  if (/vendor opportunit|exhibitor opportunit|vendor booth|booth fee|exhibitor prospectus/.test(lowerText)) {
    return "VendorOrExhibitorOpportunityPage";
  }
  const generalSponsorSignal =
    /become a sponsor|sponsorship opportunit|sponsorship package|sponsor levels|sponsorship levels|corporate sponsorship|sponsor our event|sponsor this event|sponsor benefits|submit sponsorship|contact us to sponsor/;
  if (!generalSponsorSignal.test(lowerText) && /become a partner|partner with us|donate/.test(lowerText)) {
    return "DonationOrPartnerPage";
  }
  return "SponsorshipOpportunityPage";
}

// Score caps by page purpose — high DR or "sponsor" mentions must not push
// non-opportunity pages up the list.
export const PAGE_PURPOSE_SCORE_CAPS: Record<PagePurpose, number> = {
  SponsorshipOpportunityPage: 100,
  SponsorPacketOrForm: 100,
  DonationOrPartnerPage: 100,
  VendorOrExhibitorOpportunityPage: 100,
  Unknown: 40,
  CurrentSponsorsOnlyPage: 35,
  GenericEventPage: 30,
  BlogArticle: 20,
  NewsArticle: 20,
  TravelOrReviewPage: 10,
  ForumThread: 10,
  SocialMediaPage: 10,
  TicketOrRegistrationPage: 10,
  DirectoryListing: 10,
  JobPosting: 0,
};

const PURPOSE_REJECTIONS: Record<
  string,
  { category: RejectionCategory; reason: string }
> = {
  BlogArticle: {
    category: "Blog/article result",
    reason: "Rejected: page is a blog/article that talks about sponsorship — it does not offer a sponsorship opportunity.",
  },
  NewsArticle: {
    category: "Blog/article result",
    reason: "Rejected: news article — not a sponsorship opportunity page.",
  },
  TravelOrReviewPage: {
    category: "Travel/review result",
    reason: "Rejected: travel/review page — not a sponsorship opportunity.",
  },
  JobPosting: {
    category: "Job/visa sponsorship result",
    reason: "Rejected: job/visa-sponsorship posting — not event or organizational sponsorship.",
  },
  ForumThread: {
    category: "Forum/social result",
    reason: "Rejected: forum thread — not a sponsorship opportunity page.",
  },
  SocialMediaPage: {
    category: "Forum/social result",
    reason: "Rejected: social media page — not a sponsorship opportunity page.",
  },
  GenericEventPage: {
    category: "Generic event/ticket result",
    reason: "Rejected: generic event page with no sponsorship opportunity language.",
  },
  TicketOrRegistrationPage: {
    category: "Generic event/ticket result",
    reason: "Rejected: ticket/registration page — not a sponsorship opportunity.",
  },
  DirectoryListing: {
    category: "No sponsorship opportunity language",
    reason: "Rejected: directory/listing page — not a sponsorship opportunity.",
  },
  CurrentSponsorsOnlyPage: {
    category: "Current sponsors only",
    reason: "Rejected: page shows current sponsors but offers no way to become one (no application, package, pricing, or contact path).",
  },
  Unknown: {
    category: "No sponsorship opportunity language",
    reason: "Rejected: no sponsorship opportunity language found in the scraped page content.",
  },
};

// ---------------------------------------------------------------------------
// Price detection
// ---------------------------------------------------------------------------

const PRICE_PATTERNS: RegExp[] = [
  // $250 / $1,234.56 / $ 300
  /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?/g,
  // 250 dollars / 1,000 dollars
  /(\d{1,3}(?:,\d{3})+|\d+)(\.\d{2})?\s*dollars\b/gi,
];

// $250-$500 / $250 – $500 / $250 to 500 (second endpoint may omit the $)
const PRICE_RANGE_PATTERN =
  /\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?\s*(?:-|–|—|to)\s*\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?/gi;

function acceptPrice(rawDigits: string, hasCents: boolean, out: Set<number>): void {
  const value = Number(rawDigits.replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value >= 10_000_000) return;
  // Years like 2024/2025/2026 are written without commas or cents — skip
  // bare 4-digit values in the plausible-year range so "© 2025" and
  // "the 2026 season" are never treated as prices.
  const looksLikeYear =
    Number.isInteger(value) &&
    value >= 1900 &&
    value <= 2100 &&
    !rawDigits.includes(",") &&
    !hasCents;
  if (looksLikeYear) return;
  out.add(value);
}

export interface DetectedPrices {
  all: number[];
  lowest: number | null;
}

export function detectPrices(text: string): DetectedPrices {
  const found = new Set<number>();
  for (const pattern of PRICE_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      acceptPrice(m[1], m[2] !== undefined, found);
    }
  }
  for (const m of text.matchAll(PRICE_RANGE_PATTERN)) {
    acceptPrice(m[1], false, found);
    acceptPrice(m[2], false, found);
  }
  const all = Array.from(found).sort((a, b) => a - b);
  return { all, lowest: all[0] ?? null };
}

// ---------------------------------------------------------------------------
// Content analysis
// ---------------------------------------------------------------------------

export interface ContentAnalysis {
  sponsorshipTerms: string[];
  backlinkTerms: string[];
  pricingTerms: string[];
  prices: number[];
  lowestPrice: number | null;
}

export function analyzeContent(text: string): ContentAnalysis {
  const { all, lowest } = detectPrices(text);
  return {
    sponsorshipTerms: matchTerms(text, SPONSORSHIP_INTENT_TERMS),
    backlinkTerms: matchTerms(text, BACKLINK_EVIDENCE_TERMS),
    pricingTerms: matchTerms(text, PRICING_TERMS),
    prices: all,
    lowestPrice: lowest,
  };
}

// ---------------------------------------------------------------------------
// Strict status logic
// ---------------------------------------------------------------------------

export interface StrictDecisionInput {
  dr: number | null;
  budget: number;
  firecrawlStatus: "success" | "failed" | "cached" | "skipped";
  contentLength: number;
  sponsorshipTerms: string[];
  backlinkTerms: string[];
  pricingTerms: string[];
  prices: number[];
  lowestPrice: number | null;
  pagePurpose: PagePurpose;
  localRelevance: LocalRelevanceRating;
}

export interface StrictDecision {
  approvalStatus: ApprovalStatus;
  approvalReason: string;
  withinBudget: boolean | null;
  rejectionCategory: RejectionCategory | null;
}

const sample = (terms: string[]): string => terms.slice(0, 3).join(", ");

/**
 * Auto-approve ONLY when all of: DR >= 25, page scraped successfully, page
 * purpose is one of the four approvable opportunity types, backlink/link
 * evidence found, a detected price at or below budget, and the page is
 * locally relevant. Missing core data goes to review — never to approve.
 * Non-opportunity page purposes are rejected outright, regardless of DR.
 */
export function decideStatus(input: StrictDecisionInput): StrictDecision {
  const withinBudget =
    input.lowestPrice === null ? null : input.lowestPrice <= input.budget;
  const verdict = (
    approvalStatus: ApprovalStatus,
    approvalReason: string,
    rejectionCategory: RejectionCategory | null = null,
  ): StrictDecision => ({ approvalStatus, approvalReason, withinBudget, rejectionCategory });

  if (input.dr === null) {
    return verdict(
      "review",
      "Review: Ahrefs DR is unavailable, so domain authority could not be verified. Not scraped, to save Firecrawl credits.",
      "Unknown",
    );
  }
  if (input.dr < DR_MINIMUM) {
    return verdict(
      "rejected",
      `Rejected: DR ${input.dr} is below the minimum threshold of ${DR_MINIMUM}.`,
      "DR below threshold",
    );
  }
  if (input.firecrawlStatus === "skipped") {
    return verdict(
      "review",
      `Review: DR ${input.dr} qualifies, but the page was not scraped this run (per-run Firecrawl cap reached).`,
      "Unknown",
    );
  }
  if (input.firecrawlStatus === "failed") {
    return verdict(
      "review",
      `Review: DR ${input.dr} qualifies, but the page could not be scraped — verify the sponsorship page manually.`,
      "Firecrawl failed",
    );
  }
  if (input.contentLength < MIN_CONTENT_LENGTH) {
    return verdict(
      "review",
      `Review: DR ${input.dr} qualifies, but scraped content was too short (${input.contentLength} chars) to evaluate.`,
      "Firecrawl failed",
    );
  }

  // Page purpose gate: only real opportunity pages can proceed.
  if (!APPROVABLE_PAGE_PURPOSES.has(input.pagePurpose)) {
    const r = PURPOSE_REJECTIONS[input.pagePurpose] ?? PURPOSE_REJECTIONS.Unknown;
    return verdict(
      "rejected",
      `${r.reason} (page purpose: ${input.pagePurpose})`,
      r.category,
    );
  }

  if (withinBudget === false) {
    return verdict(
      "rejected",
      `Rejected: All detected prices are above the $${input.budget} budget (lowest found: $${input.lowestPrice}).`,
      "Over budget",
    );
  }

  const hasLinkEvidence = input.backlinkTerms.length > 0;
  const locallyRelevant =
    input.localRelevance === "High" || input.localRelevance === "Medium";

  if (hasLinkEvidence && withinBudget === true && locallyRelevant) {
    return verdict(
      "approved",
      `Approved: ${input.pagePurpose} with DR ${input.dr}, website link evidence (${sample(input.backlinkTerms)}), and $${input.lowestPrice} within the $${input.budget} budget.`,
    );
  }
  if (hasLinkEvidence && withinBudget === true) {
    return verdict(
      "review",
      `Review: real sponsorship opportunity (DR ${input.dr}, $${input.lowestPrice} in budget, link evidence found), but local relevance is unclear — verify the location.`,
      "Low local relevance",
    );
  }
  if (hasLinkEvidence) {
    return verdict(
      "review",
      `Review: ${input.pagePurpose} with DR ${input.dr} and link evidence, but pricing was not found on the scraped page.`,
      "No pricing found",
    );
  }
  if (withinBudget === true) {
    return verdict(
      "review",
      `Review: ${input.pagePurpose} with DR ${input.dr} and pricing found ($${input.lowestPrice}), but backlink or website-link evidence was unclear.`,
      "No backlink evidence",
    );
  }
  return verdict(
    "review",
    `Review: ${input.pagePurpose} with DR ${input.dr}, but neither pricing nor website-link evidence could be confirmed.`,
    "No pricing found",
  );
}
