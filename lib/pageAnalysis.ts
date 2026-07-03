// Strict, rule-based analysis of scraped sponsorship pages. Pure functions —
// no network or database access — so they are unit-testable (npm test) and
// reusable for the future citation research tool.
//
// Approval is never based on SERP titles/snippets or URL text: the inputs
// here are actual scraped page content plus the Ahrefs DR gate.

import {
  BACKLINK_EVIDENCE_TERMS,
  DR_MINIMUM,
  MIN_CONTENT_LENGTH,
  PRICING_TERMS,
  SPONSORSHIP_INTENT_TERMS,
} from "./sponsorshipConfig";
import type { ApprovalStatus } from "./types";

export function matchTerms(text: string, terms: readonly string[]): string[] {
  const lower = text.toLowerCase();
  return terms.filter((t) => lower.includes(t.toLowerCase()));
}

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
  spamDomain?: boolean;
}

export interface StrictDecision {
  approvalStatus: ApprovalStatus;
  approvalReason: string;
  withinBudget: boolean | null;
}

const sample = (terms: string[]): string => terms.slice(0, 3).join(", ");

/**
 * Auto-approve ONLY when all of: DR >= 25, sponsorship intent term found in
 * scraped content, backlink/link evidence term found, and a detected price at
 * or below budget. Anything with missing core data goes to review — never to
 * approve. Clear misses (low DR, no sponsorship language, all prices above
 * budget, spam domains) are rejected.
 */
export function decideStatus(input: StrictDecisionInput): StrictDecision {
  const withinBudget =
    input.lowestPrice === null ? null : input.lowestPrice <= input.budget;
  const verdict = (
    approvalStatus: ApprovalStatus,
    approvalReason: string,
  ): StrictDecision => ({ approvalStatus, approvalReason, withinBudget });

  if (input.spamDomain) {
    return verdict(
      "rejected",
      "Rejected: URL is a job board, coupon site, or generic directory — not a sponsorship opportunity.",
    );
  }
  if (input.dr === null) {
    return verdict(
      "review",
      "Review: Ahrefs DR is unavailable, so domain authority could not be verified. Not scraped, to save Firecrawl credits.",
    );
  }
  if (input.dr < DR_MINIMUM) {
    return verdict(
      "rejected",
      `Rejected: DR ${input.dr} is below the minimum threshold of ${DR_MINIMUM}.`,
    );
  }
  if (input.firecrawlStatus === "skipped") {
    return verdict(
      "review",
      `Review: DR ${input.dr} qualifies, but the page was not scraped this run (per-run Firecrawl cap reached).`,
    );
  }
  if (input.firecrawlStatus === "failed") {
    return verdict(
      "review",
      `Review: DR ${input.dr} qualifies, but the page could not be scraped — verify the sponsorship page manually.`,
    );
  }
  if (input.contentLength < MIN_CONTENT_LENGTH) {
    return verdict(
      "review",
      `Review: DR ${input.dr} qualifies, but scraped content was too short (${input.contentLength} chars) to evaluate.`,
    );
  }
  if (input.sponsorshipTerms.length === 0) {
    return verdict(
      "rejected",
      "Rejected: No sponsorship terms were found in the scraped page content.",
    );
  }
  if (withinBudget === false) {
    return verdict(
      "rejected",
      `Rejected: All detected prices are above the $${input.budget} budget (lowest found: $${input.lowestPrice}).`,
    );
  }

  const hasLinkEvidence = input.backlinkTerms.length > 0;
  if (hasLinkEvidence && withinBudget === true) {
    return verdict(
      "approved",
      `Approved: DR ${input.dr}, sponsorship terms found (${sample(input.sponsorshipTerms)}), website link evidence found (${sample(input.backlinkTerms)}), and $${input.lowestPrice} is within the $${input.budget} budget.`,
    );
  }
  if (hasLinkEvidence) {
    return verdict(
      "review",
      `Review: DR ${input.dr} and sponsorship terms found, but pricing was not found on the scraped page.`,
    );
  }
  if (withinBudget === true) {
    return verdict(
      "review",
      `Review: DR ${input.dr} and sponsorship pricing found ($${input.lowestPrice}), but backlink or website link evidence was unclear.`,
    );
  }
  return verdict(
    "review",
    `Review: DR ${input.dr} and sponsorship terms found, but neither pricing nor website link evidence could be confirmed.`,
  );
}
