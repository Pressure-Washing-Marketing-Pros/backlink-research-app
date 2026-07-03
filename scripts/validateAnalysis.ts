// Rule-based validation cases for the strict sponsorship page analyzer.
// Run with: npm test   (or: npx tsx scripts/validateAnalysis.ts)
//
// These cover the strict status logic, price detection (including the
// year-vs-price guard), keyword matching, crawl-cache freshness, and URL
// normalization — all pure functions with no network or database access.
import assert from "node:assert/strict";
import {
  analyzeContent,
  decideStatus,
  detectPrices,
  matchTerms,
} from "../lib/pageAnalysis";
import { isCrawlCacheFresh } from "../lib/sponsorshipConfig";
import { normalizeUrl } from "../lib/urlNormalize";

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e instanceof Error ? e.message : e}`);
  }
}

const base = {
  budget: 300,
  firecrawlStatus: "success" as const,
  contentLength: 5000,
  sponsorshipTerms: [] as string[],
  backlinkTerms: [] as string[],
  pricingTerms: [] as string[],
  prices: [] as number[],
  lowestPrice: null as number | null,
};

console.log("Strict status logic:");
check("DR 30 + sponsorship term + link evidence + $250 → approved", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsorship"],
    backlinkTerms: ["website link"],
    pricingTerms: ["$"],
    prices: [250],
    lowestPrice: 250,
  });
  assert.equal(d.approvalStatus, "approved");
  assert.ok(d.approvalReason.includes("$250"));
});
check("DR 30 + sponsorship + $250 but no backlink term → review", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsor"],
    prices: [250],
    lowestPrice: 250,
  });
  assert.equal(d.approvalStatus, "review");
});
check("DR 30 + sponsorship + backlink term but no price → review", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["sponsor logo"],
  });
  assert.equal(d.approvalStatus, "review");
});
check("DR 20 + all page criteria matched → rejected (below DR 25)", () => {
  const d = decideStatus({
    ...base,
    dr: 20,
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["website link"],
    prices: [250],
    lowestPrice: 250,
  });
  assert.equal(d.approvalStatus, "rejected");
  assert.ok(d.approvalReason.includes("below the minimum"));
});
check("DR 30 + no sponsorship terms → rejected", () => {
  const d = decideStatus({ ...base, dr: 30 });
  assert.equal(d.approvalStatus, "rejected");
});
check("DR 30 + sponsorship + backlink + only $500 (budget $300) → never approved", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["website link"],
    prices: [500],
    lowestPrice: 500,
  });
  assert.notEqual(d.approvalStatus, "approved");
  assert.equal(d.approvalStatus, "rejected"); // all prices above budget
});
check("Firecrawl failure → review, never approved", () => {
  const d = decideStatus({ ...base, dr: 40, firecrawlStatus: "failed" });
  assert.equal(d.approvalStatus, "review");
});
check("Spam/job-board domain → rejected", () => {
  const d = decideStatus({
    ...base,
    dr: 50,
    spamDomain: true,
    sponsorshipTerms: ["sponsor"],
  });
  assert.equal(d.approvalStatus, "rejected");
});
check("DR unavailable → review", () => {
  const d = decideStatus({ ...base, dr: null });
  assert.equal(d.approvalStatus, "review");
});
check("Very short scraped content → review", () => {
  const d = decideStatus({ ...base, dr: 30, contentLength: 50 });
  assert.equal(d.approvalStatus, "review");
});

console.log("Price detection:");
check("detects $ amounts, ranges, and 'N dollars'", () => {
  const p = detectPrices("Gold $1,000. Silver $250-$500. Bronze 100 dollars.");
  assert.deepEqual(p.all, [100, 250, 500, 1000]);
  assert.equal(p.lowest, 100);
});
check("ignores years (2024, 2025, 2026, © 2025)", () => {
  const p = detectPrices(
    "Join us for the 2025 gala! © 2024 Community Org. Established 2026.",
  );
  assert.deepEqual(p.all, []);
});
check("keeps $2,025 (comma-formatted → price, not year)", () => {
  assert.deepEqual(detectPrices("Platinum tier: $2,025").all, [2025]);
});
check("parses '$250 to 500' range with missing second $", () => {
  const p = detectPrices("Packages from $250 to 500 available");
  assert.ok(p.all.includes(250) && p.all.includes(500));
});

console.log("Keyword matching:");
check("case-insensitive matching on scraped text", () => {
  const m = matchTerms(
    "BECOME A SPONSOR today — Sponsorship Opportunities",
    ["become a sponsor", "sponsorship opportunities"],
  );
  assert.equal(m.length, 2);
});
check("analyzeContent wires all three keyword groups together", () => {
  const a = analyzeContent(
    "Become a sponsor! Your sponsor logo and website link included. Gold package $250.",
  );
  assert.ok(a.sponsorshipTerms.length > 0);
  assert.ok(a.backlinkTerms.length > 0);
  assert.equal(a.lowestPrice, 250);
});

console.log("Crawl cache freshness:");
const now = 1_800_000_000;
const day = 86400;
check("successful crawl reused within the 60-day window", () => {
  assert.equal(
    isCrawlCacheFresh({ status: "success", fetched_at: now - 30 * day }, now),
    true,
  );
});
check("successful crawl re-scraped after the window", () => {
  assert.equal(
    isCrawlCacheFresh({ status: "success", fetched_at: now - 61 * day }, now),
    false,
  );
});
check("failed crawl only reused for 1 day", () => {
  assert.equal(
    isCrawlCacheFresh({ status: "failed", fetched_at: now - 2 * day }, now),
    false,
  );
  assert.equal(
    isCrawlCacheFresh({ status: "failed", fetched_at: now - day / 2 }, now),
    true,
  );
});

console.log("URL normalization:");
check("strips tracking params, www, and trailing slash", () => {
  const a = normalizeUrl("https://www.Example.com/Sponsors/?utm_source=x&fbclid=y");
  const b = normalizeUrl("https://example.com/sponsors");
  assert.ok(a && b);
  assert.equal(a.key, b.key);
});
check("keeps meaningful query params", () => {
  const a = normalizeUrl("https://example.com/events?id=5");
  assert.ok(a);
  assert.equal(a.key, "example.com/events?id=5");
});

if (failures > 0) {
  console.error(`\n${failures} validation case(s) failed.`);
  process.exit(1);
}
console.log("\nAll validation cases passed.");
