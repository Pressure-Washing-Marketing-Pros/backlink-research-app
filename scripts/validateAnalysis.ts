// Rule-based validation cases for the strict sponsorship page analyzer.
// Run with: npm test   (or: npx tsx scripts/validateAnalysis.ts)
//
// Includes regression cases built from the real 2026-07-03 Fort Lauderdale
// run, where blog posts, TripAdvisor pages, job listings, forums, and ticket
// pages leaked through — those must all be rejected now.
import assert from "node:assert/strict";
import {
  PAGE_PURPOSE_SCORE_CAPS,
  analyzeContent,
  classifyPagePurpose,
  decideStatus,
  detectPrices,
  matchTerms,
  preFilterSerpResult,
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
  pagePurpose: "SponsorshipOpportunityPage" as const,
  localRelevance: "High" as const,
};

console.log("Pre-filter (regressions from the 2026-07-03 Fort Lauderdale run):");
check("tripadvisor.com tourism page → rejected before any API spend", () => {
  const v = preFilterSerpResult({
    url: "https://www.tripadvisor.com/Tourism-g34227-Fort_Lauderdale_Broward_County_Florida-Vacations.html",
    title: "Fort Lauderdale, FL: All You Must Know Before ...",
    domain: "tripadvisor.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Travel/review result");
});
check("Eventbrite blog article about getting sponsors → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://www.eventbrite.com/blog/guide-to-event-sponsorship-ds00/",
    title: "How to Get Sponsors for an Event: Tips from Industry Pros",
    domain: "eventbrite.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Blog/article result");
});
check("careers page → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://careers.browardhealth.org/us/en/job/BHPBHQUS26627EXTERNALENUS/Community-Relations-Specialist",
    title: "Community Relations Specialist in Fort Lauderdale, FL, US",
    domain: "careers.browardhealth.org",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Job/visa sponsorship result");
});
check("visa sponsorship job listing → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://jobtoday.com/us/jobs-visa-sponsorship/fl_fort-lauderdale",
    title: "87 Best visa sponsorship Jobs in Fort Lauderdale, Florida ...",
    domain: "jobtoday.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Job/visa sponsorship result");
});
check("reddit forum thread → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://www.reddit.com/r/FRC/comments/4dgc25/how_to_start_a_first_lego_league_team",
    title: "How to start a First Lego League Team? : r/FRC",
    domain: "reddit.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Forum/social result");
});
check("LinkedIn Pulse article → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://www.linkedin.com/pulse/how-our-community-sponsors-inspire-central-xuoof",
    title: "How Our Community Sponsors Inspire Central Florida ...",
    domain: "linkedin.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Forum/social result");
});
check("generic event ticket page → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://www.tixr.com/groups/redbullgrc/events/round-1-fort-lauderdale-1071",
    title: "Round 1: Fort Lauderdale tickets by Red Bull GRC",
    domain: "tixr.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Generic event/ticket result");
});
check('"Meet Our Sponsors" title with no opportunity signal → rejected', () => {
  const v = preFilterSerpResult({
    url: "https://fpea.com/events/6001/2022-fpea-florida-homeschool-convention/meet-our-sponsors",
    title: "Meet Our Sponsors",
    domain: "fpea.com",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Current sponsors only");
});
check("news article → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://nsunews.nova.edu/sharkbytes/community-news/page/43/index.html",
    title: "Community News | NSU Newsroom - Part 43",
    domain: "nsunews.nova.edu",
  });
  assert.equal(v.pass, false);
  assert.equal(v.category, "Blog/article result");
});
check("official Sponsorship Opportunities page → passes pre-filter", () => {
  const v = preFilterSerpResult({
    url: "https://www.acg.org/southflorida/sponsorship/sponsorship-opportunities",
    title: "Sponsorship Opportunities | ACG South Florida",
    domain: "acg.org",
  });
  assert.equal(v.pass, true);
});
check("race sponsor page → passes pre-filter", () => {
  const v = preFilterSerpResult({
    url: "https://runsignup.com/Race/Sponsors/FL/FortLauderdale/FortLauderdale131",
    title: "The 20th Annual Liquid Youth Fort Lauderdale Running ...",
    domain: "runsignup.com",
  });
  assert.equal(v.pass, true);
});
check("PDF sponsorship packet → passes pre-filter", () => {
  const v = preFilterSerpResult({
    url: "https://cdn.ymaws.com/www.bioflorida.com/resource/resmgr/2026_conference/2026_sponsorship_prospectus_.pdf",
    title: "Sponsorship Opportunities",
    domain: "cdn.ymaws.com",
  });
  assert.equal(v.pass, true);
});
check("unrelated PDF (housing policy) → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://selc.wordpress.ncsu.edu/files/2013/03/Rethinking-Federal-Housing-Policy.pdf",
    title: "Rethinking Federal Housing Policy",
    domain: "selc.wordpress.ncsu.edu",
  });
  assert.equal(v.pass, false);
});
check("job board domain (ziprecruiter) → rejected", () => {
  const v = preFilterSerpResult({
    url: "https://www.ziprecruiter.com/jobs/fort-lauderdale",
    title: "Jobs in Fort Lauderdale",
    domain: "ziprecruiter.com",
  });
  assert.equal(v.pass, false);
});

console.log("Page purpose classifier:");
check("blog URL is BlogArticle even when content has opportunity phrases", () => {
  const p = classifyPagePurpose(
    "https://www.eventbrite.com/blog/guide-to-event-sponsorship-ds00/",
    "How to Get Sponsors for an Event",
    "Sponsorship opportunities are everywhere. To become a sponsor magnet, offer sponsorship packages...",
  );
  assert.equal(p, "BlogArticle");
});
check('"become a sponsor" page with packages → SponsorshipOpportunityPage', () => {
  const p = classifyPagePurpose(
    "https://example.org/sponsorship",
    "Become a Sponsor",
    "Become a sponsor of our festival! Sponsorship packages start at $250. Sponsor benefits include your logo with link on our website.",
  );
  assert.equal(p, "SponsorshipOpportunityPage");
});
check("PDF packet with opportunity language → SponsorPacketOrForm", () => {
  const p = classifyPagePurpose(
    "https://example.org/files/2026-sponsorship-packet.pdf",
    "2026 Sponsorship Packet",
    "Sponsorship opportunities for 2026. Gold sponsor $1,000. Complete the sponsor application to reserve.",
  );
  assert.equal(p, "SponsorPacketOrForm");
});
check("vendor/exhibitor page → VendorOrExhibitorOpportunityPage", () => {
  const p = classifyPagePurpose(
    "https://example.org/get-involved",
    "Get Involved",
    "Vendor opportunities available! Booth fee is $200 and exhibitor opportunities include recognition on our website.",
  );
  assert.equal(p, "VendorOrExhibitorOpportunityPage");
});
check('"thank you to our sponsors" only → CurrentSponsorsOnlyPage', () => {
  const p = classifyPagePurpose(
    "https://example.org/sponsors",
    "Our Sponsors",
    "Thank you to our sponsors! This event was sponsored by Acme Co and presented by Beta Corp.",
  );
  assert.equal(p, "CurrentSponsorsOnlyPage");
});
check("social URL → SocialMediaPage", () => {
  const p = classifyPagePurpose(
    "https://www.instagram.com/reel/DZvWqA8sFNr",
    "Weekly sponsor shout-out",
    "become a sponsor",
  );
  assert.equal(p, "SocialMediaPage");
});
check("no sponsor language at all → Unknown", () => {
  const p = classifyPagePurpose(
    "https://example.org/about",
    "About Us",
    "We are a community organization founded in 1998 serving the local area.",
  );
  assert.equal(p, "Unknown");
});

console.log("Strict status logic:");
check("real opportunity page + DR 30 + link evidence + $250 + local → approved", () => {
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
  assert.equal(d.rejectionCategory, null);
});
check("BlogArticle with perfect signals → rejected, never approved", () => {
  const d = decideStatus({
    ...base,
    dr: 94,
    pagePurpose: "BlogArticle",
    sponsorshipTerms: ["sponsorship"],
    backlinkTerms: ["sponsor page"],
    prices: [1],
    lowestPrice: 1,
  });
  assert.equal(d.approvalStatus, "rejected");
  assert.equal(d.rejectionCategory, "Blog/article result");
});
check("TravelOrReviewPage → rejected", () => {
  const d = decideStatus({ ...base, dr: 93, pagePurpose: "TravelOrReviewPage" });
  assert.equal(d.approvalStatus, "rejected");
  assert.equal(d.rejectionCategory, "Travel/review result");
});
check("JobPosting → rejected", () => {
  const d = decideStatus({ ...base, dr: 65, pagePurpose: "JobPosting" });
  assert.equal(d.approvalStatus, "rejected");
  assert.equal(d.rejectionCategory, "Job/visa sponsorship result");
});
check("CurrentSponsorsOnlyPage → rejected", () => {
  const d = decideStatus({ ...base, dr: 50, pagePurpose: "CurrentSponsorsOnlyPage" });
  assert.equal(d.approvalStatus, "rejected");
  assert.equal(d.rejectionCategory, "Current sponsors only");
});
check("Unknown purpose → rejected (no opportunity language)", () => {
  const d = decideStatus({ ...base, dr: 30, pagePurpose: "Unknown" });
  assert.equal(d.approvalStatus, "rejected");
  assert.equal(d.rejectionCategory, "No sponsorship opportunity language");
});
check("opportunity page but no price → review (No pricing found)", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["sponsor logo"],
  });
  assert.equal(d.approvalStatus, "review");
  assert.equal(d.rejectionCategory, "No pricing found");
});
check("opportunity page but no link evidence → review (No backlink evidence)", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsor"],
    prices: [250],
    lowestPrice: 250,
  });
  assert.equal(d.approvalStatus, "review");
  assert.equal(d.rejectionCategory, "No backlink evidence");
});
check("opportunity page but local relevance unknown → review (Low local relevance)", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    localRelevance: "Unknown",
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["website link"],
    prices: [250],
    lowestPrice: 250,
  });
  assert.equal(d.approvalStatus, "review");
  assert.equal(d.rejectionCategory, "Low local relevance");
});
check("DR 20 + everything matched → rejected (below DR 25)", () => {
  const d = decideStatus({
    ...base,
    dr: 20,
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["website link"],
    prices: [250],
    lowestPrice: 250,
  });
  assert.equal(d.approvalStatus, "rejected");
  assert.equal(d.rejectionCategory, "DR below threshold");
});
check("only $500 (budget $300) → rejected, never approved", () => {
  const d = decideStatus({
    ...base,
    dr: 30,
    sponsorshipTerms: ["sponsor"],
    backlinkTerms: ["website link"],
    prices: [500],
    lowestPrice: 500,
  });
  assert.notEqual(d.approvalStatus, "approved");
  assert.equal(d.rejectionCategory, "Over budget");
});
check("Firecrawl failure → review, never approved", () => {
  const d = decideStatus({ ...base, dr: 40, firecrawlStatus: "failed" });
  assert.equal(d.approvalStatus, "review");
  assert.equal(d.rejectionCategory, "Firecrawl failed");
});
check("DR unavailable → review", () => {
  const d = decideStatus({ ...base, dr: null });
  assert.equal(d.approvalStatus, "review");
});
check("very short scraped content → review", () => {
  const d = decideStatus({ ...base, dr: 30, contentLength: 50 });
  assert.equal(d.approvalStatus, "review");
});

console.log("Score caps:");
check("non-opportunity purposes are capped low", () => {
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.JobPosting, 0);
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.TravelOrReviewPage, 10);
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.BlogArticle, 20);
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.GenericEventPage, 30);
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.CurrentSponsorsOnlyPage, 35);
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.Unknown, 40);
  assert.equal(PAGE_PURPOSE_SCORE_CAPS.SponsorshipOpportunityPage, 100);
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
