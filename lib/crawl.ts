import type {
  ClientInputs,
  LinkOpportunityStatus,
  PaymentType,
  SubmissionMethod,
  YesNo,
} from "@/lib/types";

const SPONSORSHIP_KEYWORDS = [
  "sponsor",
  "sponsors",
  "sponsorship",
  "sponsorship package",
  "become a sponsor",
  "sponsor opportunities",
  "community partners",
  "partners",
  "supporters",
  "donor recognition",
  "corporate sponsors",
];

const CURRENT_SPONSORS_PATTERNS = [
  "our sponsors",
  "current sponsors",
  "sponsor list",
  "supporters",
  "partners",
  "donor recognition",
  "corporate sponsors",
  "community partners",
  "sponsor directory",
  "sponsor gallery",
];

const LINK_EVIDENCE_PATTERNS = [
  "website link",
  "linked logo",
  "linked business name",
  "online sponsor recognition",
  "website recognition",
  "link to sponsor",
  "online sponsor",
  "link to your website",
];

const DONATION_ONLY_PATTERNS = [
  "donate",
  "give now",
  "contribute",
  "donation",
  "fundraiser",
  "support our cause",
  "gift",
];

const PAYMENT_TYPE_PATTERNS: Array<[PaymentType, RegExp]> = [
  ["One-Time", /one[- ]time|one time|one‑time|oneoff|single payment/i],
  ["Annual", /annual|annually|yearly/i],
  ["Monthly", /monthly|per month/i],
  ["Recurring", /recurring|ongoing|renewal|subscription/i],
];

const TIER_KEYWORDS = [
  "bronze",
  "silver",
  "gold",
  "platinum",
  "community",
  "partner",
  "supporter",
  "friend",
  "corporate",
  "donor",
  "title",
];

const OPPORTUNITY_TYPE_PATTERNS: Array<[string, RegExp]> = [
  ["School / PTA / Booster Club", /school|pta|booster/],
  ["Race / Marathon", /race|marathon|5k|10k|fun run|run\/walk|walkathon/],
  ["Chamber / Association", /chamber|association|society/],
  ["Arts / Museum / Historic Org", /museum|historic|historic society|arts|gallery|theatre|theater/],
  ["Animal Rescue", /animal rescue|rescue|humane society|animal shelter/],
  ["Foundation", /foundation/],
  ["Event", /festival|fair|event|expo|gala|celebration|charity event/],
  ["Community Group", /community|neighborhood|civic|garden club|rotary|lions|kiwanis|service club/],
  ["Club / Recreation", /club|recreation|league|sports|team/],
  ["Nonprofit", /nonprofit|non-profit|charity|organization/],
];

function normalizeUrl(href: string, base: string): string | null {
  try {
    if (!href) return null;
    if (href.startsWith("javascript:")) return null;
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function sameDomain(url: string, rootDomain: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return hostname === rootDomain;
  } catch {
    return false;
  }
}

function isPdfUrl(url: string): boolean {
  return url.toLowerCase().includes(".pdf");
}

async function fetchPage(url: string) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type") ?? "";
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      url,
      contentType,
      text,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      contentType: "",
      text: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function parseHtml(text: string): Document | null {
  try {
    return new DOMParser().parseFromString(text, "text/html");
  } catch {
    return null;
  }
}

function getPageText(doc: Document): string {
  return doc.body?.textContent ?? "";
}

export function findEmails(text: string): string[] {
  return Array.from(text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)).map((m) => m[0]);
}

function findPhone(text: string): string | "" {
  const match = text.match(/(?:\+1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/);
  return match?.[0] ?? "";
}

function findContactPerson(text: string): string {
  const match = text.match(/(?:contact|inquiries|inquiry|reach out to|reach us at)\s*(?:is\s*)?(?:[:\-]?\s*)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})/i);
  return match?.[1] ?? "";
}

function extractDollarAmount(text: string): string {
  const match = text.match(/\$\s?[0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?/);
  return match?.[0] ?? "Unknown";
}

export function parsePaymentType(text: string): PaymentType {
  const lower = text.toLowerCase();
  for (const [type, pattern] of PAYMENT_TYPE_PATTERNS) {
    if (pattern.test(lower)) return type;
  }
  return "Unknown";
}

function extractTierName(text: string): string {
  const lower = text.toLowerCase();
  for (const keyword of TIER_KEYWORDS) {
    if (lower.includes(keyword)) return keyword.charAt(0).toUpperCase() + keyword.slice(1);
  }
  return "Unknown";
}

export function classifyOpportunityType(text: string): string {
  const lower = text.toLowerCase();
  for (const [type, pattern] of OPPORTUNITY_TYPE_PATTERNS) {
    if (pattern.test(lower)) return type;
  }
  return "Unknown";
}

function findRelevantLinks(doc: Document, baseUrl: string, rootDomain: string): string[] {
  const anchors = Array.from(doc.querySelectorAll("a[href]"));
  const urls = new Set<string>();
  const keywords = [...SPONSORSHIP_KEYWORDS, "package", "membership", "form", "contact"];

  for (const anchor of anchors) {
    const href = anchor.getAttribute("href")?.trim();
    const normalized = href ? normalizeUrl(href, baseUrl) : null;
    if (!normalized) continue;
    if (normalized.startsWith("mailto:") || normalized.startsWith("tel:")) continue;
    if (!sameDomain(normalized, rootDomain)) continue;

    const lowerHref = normalized.toLowerCase();
    const lowerText = (anchor.textContent ?? "").toLowerCase();
    const hasKeyword = keywords.some(
      (keyword) => lowerHref.includes(keyword) || lowerText.includes(keyword),
    );
    if (hasKeyword || isPdfUrl(lowerHref)) {
      urls.add(normalized);
    }
  }

  return Array.from(urls).slice(0, 10);
}

interface PageAnalysis {
  url: string;
  isHtml: boolean;
  hasSponsorshipKeywords: boolean;
  hasSponsorList: boolean;
  hasLinkPhrase: boolean;
  isDonationOnly: boolean;
  externalSponsorLinkCount: number;
  currentSponsorsDisplayedPublicly: YesNo | "Unknown";
  currentSponsorsLinked: YesNo | "Unknown";
  linkOpportunityStatus: LinkOpportunityStatus | "Unknown";
  linkEvidence: string;
  paymentAmount: string;
  paymentType: PaymentType;
  tierName: string;
  submissionMethod: SubmissionMethod;
  submissionUrl: string;
  contactEmail: string;
  contactPerson: string;
  freshnessNotes: string;
  opportunityType: string;
  score: number;
  crawlNotes: string[];
  pageText: string;
}

function analyzePage(url: string, html: string, rootDomain: string): PageAnalysis {
  const doc = parseHtml(html);
  const pageText = doc ? getPageText(doc) : "";
  const lower = pageText.toLowerCase();

  const hasSponsorshipKeywords = SPONSORSHIP_KEYWORDS.some((keyword) => lower.includes(keyword));
  const hasSponsorList = CURRENT_SPONSORS_PATTERNS.some((keyword) => lower.includes(keyword));
  const hasLinkPhrase = LINK_EVIDENCE_PATTERNS.some((keyword) => lower.includes(keyword));
  const isDonationOnly = DONATION_ONLY_PATTERNS.some((keyword) => lower.includes(keyword)) && !hasSponsorshipKeywords;

  const anchors = doc ? Array.from(doc.querySelectorAll("a[href]")).map((anchor) => {
    const href = anchor.getAttribute("href")?.trim() ?? "";
    const normalized = normalizeUrl(href, url);
    return {
      href: normalized,
      text: anchor.textContent?.trim() ?? "",
    };
  }) : [];

  const externalSponsorLinks = anchors.filter((anchor) => {
    if (!anchor.href) return false;
    if (anchor.href.startsWith("mailto:") || anchor.href.startsWith("tel:")) return false;
    if (sameDomain(anchor.href, rootDomain)) return false;
    return true;
  }).length;

  const currentSponsorsDisplayedPublicly = hasSponsorList || hasSponsorshipKeywords ? "Yes" : "Unknown";
  const currentSponsorsLinked = externalSponsorLinks > 0 ? "Yes" : hasSponsorList ? "No" : "Unknown";

  let linkOpportunityStatus: LinkOpportunityStatus | "Unknown" = "Unknown";
  if (isDonationOnly) {
    linkOpportunityStatus = "No Link Opportunity";
  } else if (hasLinkPhrase || externalSponsorLinks > 0) {
    linkOpportunityStatus = "Confirmed";
  } else if (hasSponsorList) {
    linkOpportunityStatus = "Probable";
  } else if (hasSponsorshipKeywords) {
    linkOpportunityStatus = "Unclear";
  }

  const linkEvidence = isDonationOnly
    ? "Page appears donation-focused with no sponsorship evidence."
    : hasLinkPhrase
    ? "Page explicitly mentions website link or linked sponsor benefits."
    : externalSponsorLinks > 0
    ? "Public sponsor links to external sites were found."
    : hasSponsorList
    ? "Sponsors are displayed publicly, but link evidence is not explicit."
    : hasSponsorshipKeywords
    ? "Sponsorship language appears, but details remain unclear."
    : "No clear sponsorship evidence found."

  const emails = findEmails(pageText);
  const phone = findPhone(pageText);
  const contactPerson = findContactPerson(pageText);
  const paymentAmount = extractDollarAmount(pageText);
  const paymentType = parsePaymentType(pageText);
  const tierName = extractTierName(pageText);

  const form = doc?.querySelector("form");
  let submissionMethod: SubmissionMethod = "Unknown";
  let submissionUrl = "";
  if (form && hasSponsorshipKeywords) {
    submissionMethod = "Form";
    submissionUrl = normalizeUrl(form.getAttribute("action") ?? url, url) ?? url;
  } else if (emails.length > 0) {
    submissionMethod = "Email";
    submissionUrl = `mailto:${emails[0]}`;
  } else if (phone && hasSponsorshipKeywords) {
    submissionMethod = "Phone";
    submissionUrl = url;
  }

  if (isPdfUrl(url)) {
    submissionMethod = submissionMethod === "Unknown" ? "PDF Package" : submissionMethod;
    submissionUrl = url;
  }

  const freshnessNotes = /©\s*(20\d{2})/.test(pageText)
    ? "Site includes a copyright year marker."
    : "No explicit freshness marker found.";

  let score = 0;
  if (!isDonationOnly) {
    score += hasSponsorList ? 30 : 0;
    score += hasLinkPhrase ? 25 : 0;
    score += externalSponsorLinks > 0 ? 20 : 0;
    score += hasSponsorshipKeywords ? 10 : 0;
    score += paymentType !== "Unknown" ? 5 : 0;
    score += submissionMethod !== "Unknown" ? 5 : 0;
  }

  const opportunityType = classifyOpportunityType(pageText + " " + url);

  const crawlNotes = [
    `Page analyzed: ${url}`,
    hasSponsorList ? "Public sponsor listing text detected." : "No sponsor list language detected.",
    hasLinkPhrase ? "Link language detected." : "",
    externalSponsorLinks > 0 ? `Found ${externalSponsorLinks} external sponsor link(s).` : "",
  ].filter(Boolean);

  return {
    url,
    isHtml: !!doc,
    hasSponsorshipKeywords,
    hasSponsorList,
    hasLinkPhrase,
    isDonationOnly,
    externalSponsorLinkCount: externalSponsorLinks,
    currentSponsorsDisplayedPublicly,
    currentSponsorsLinked,
    linkOpportunityStatus,
    linkEvidence,
    paymentAmount,
    paymentType,
    tierName,
    submissionMethod,
    submissionUrl,
    contactEmail: emails[0] ?? "",
    contactPerson,
    freshnessNotes,
    opportunityType,
    score,
    crawlNotes,
    pageText,
  };
}

export interface SponsorshipCrawlResult {
  sponsorshipUrl: string;
  sponsorPageUrl: string;
  opportunityType: string;
  city: string;
  state: string;
  currentSponsorsDisplayedPublicly: YesNo | "Unknown";
  currentSponsorsLinked: YesNo | "Unknown";
  linkOpportunityStatus: LinkOpportunityStatus | "Unknown";
  linkEvidence: string;
  paymentAmount: string;
  paymentType: PaymentType;
  cheapestTierWithLink: string;
  tierName: string;
  submissionMethod: SubmissionMethod;
  submissionUrl: string;
  contactEmail: string;
  contactPerson: string;
  freshnessSiteQualityNotes: string;
  crawlNotes: string;
  crawlError?: string;
}

function buildDefaultCrawl(url: string): SponsorshipCrawlResult {
  return {
    sponsorshipUrl: url,
    sponsorPageUrl: "",
    opportunityType: "Unknown",
    city: "",
    state: "",
    currentSponsorsDisplayedPublicly: "Unknown",
    currentSponsorsLinked: "Unknown",
    linkOpportunityStatus: "Unknown",
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
    crawlNotes: "No crawl performed.",
  };
}

export async function crawlCandidate(
  startUrl: string,
  rootDomain: string,
  inputs: ClientInputs,
): Promise<SponsorshipCrawlResult> {
  const defaultResult = buildDefaultCrawl(startUrl);
  defaultResult.sponsorshipUrl = startUrl;

  if (!startUrl.startsWith("https://")) {
    defaultResult.crawlError = "Non-HTTPS URL skipped.";
    defaultResult.linkOpportunityStatus = "No Link Opportunity";
    defaultResult.crawlNotes = "Candidate was skipped because the URL is not HTTPS.";
    return defaultResult;
  }

  const homepage = await fetchPage(startUrl);
  if (!homepage.ok || !homepage.contentType.includes("html")) {
    defaultResult.crawlError = homepage.error ?? `Failed to fetch page: HTTP ${homepage.status}`;
    defaultResult.linkOpportunityStatus = "Unknown";
    defaultResult.crawlNotes = homepage.error
      ? `Fetch error: ${homepage.error}`
      : `Failed to load HTML page: HTTP ${homepage.status}`;
    return defaultResult;
  }

  const rootDoc = parseHtml(homepage.text);
  if (!rootDoc) {
    defaultResult.crawlError = "Unable to parse homepage HTML.";
    defaultResult.linkOpportunityStatus = "Unknown";
    defaultResult.crawlNotes = "Homepage HTML parsing failed.";
    return defaultResult;
  }

  const candidateUrls = [startUrl, ...findRelevantLinks(rootDoc, startUrl, rootDomain)];
  const analyses = [];

  for (const candidateUrl of candidateUrls.slice(0, 10)) {
    const page = candidateUrl === startUrl ? homepage : await fetchPage(candidateUrl);
    if (!page.ok || !page.contentType.includes("html")) {
      continue;
    }
    analyses.push(analyzePage(candidateUrl, page.text, rootDomain));
  }

  if (analyses.length === 0) {
    defaultResult.crawlError = "No valid sponsorship pages were discovered during crawl.";
    defaultResult.linkOpportunityStatus = "Unknown";
    defaultResult.crawlNotes = "Crawl completed but no sponsor-related HTML pages were found.";
    return defaultResult;
  }

  const best = analyses.sort((a, b) => b.score - a.score)[0];
  const city = [inputs.client_primary_city, ...(inputs.service_area_cities ?? [])].find((term) =>
    best.pageText.toLowerCase().includes(term.toLowerCase()),
  );
  const state = [inputs.client_state, inputs.state_abbrev ?? ""].find((term) =>
    term && best.pageText.toLowerCase().includes(term.toLowerCase()),
  );

  return {
    sponsorshipUrl: best.url,
    sponsorPageUrl: best.url,
    opportunityType: best.opportunityType,
    city: city ?? "",
    state: state ?? "",
    currentSponsorsDisplayedPublicly: best.currentSponsorsDisplayedPublicly,
    currentSponsorsLinked: best.currentSponsorsLinked,
    linkOpportunityStatus: best.linkOpportunityStatus,
    linkEvidence: best.linkEvidence,
    paymentAmount: best.paymentAmount,
    paymentType: best.paymentType,
    cheapestTierWithLink:
      best.linkOpportunityStatus === "Confirmed" || best.linkOpportunityStatus === "Probable"
        ? best.tierName
        : "Unknown",
    tierName: best.tierName,
    submissionMethod: best.submissionMethod,
    submissionUrl: best.submissionUrl,
    contactEmail: best.contactEmail,
    contactPerson: best.contactPerson,
    freshnessSiteQualityNotes: best.freshnessNotes,
    crawlNotes: best.crawlNotes.join(" "),
  };
}
