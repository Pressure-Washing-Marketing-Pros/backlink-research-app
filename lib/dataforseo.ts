import "server-only";
import type { SerpResult } from "@/lib/types";

interface DataForSeoOrganicItem {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  url?: string;
  title?: string;
  description?: string;
  domain?: string;
  breadcrumb?: string;
}

interface DataForSeoTaskResult {
  items?: DataForSeoOrganicItem[];
}

interface DataForSeoTask {
  status_code?: number;
  status_message?: string;
  result?: DataForSeoTaskResult[];
}

interface DataForSeoResponse {
  status_code?: number;
  status_message?: string;
  tasks?: DataForSeoTask[];
}

function basicAuthHeader(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error(
      "Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD in environment",
    );
  }
  const encoded = Buffer.from(`${login}:${password}`).toString("base64");
  return `Basic ${encoded}`;
}

export function rootDomain(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export interface SerpQueryOptions {
  query: string;
  target_city: string;
  target_state: string;
  depth?: number;
  location_code?: number;
  language_code?: string;
}

export interface OnPageLink {
  url: string;
  anchor: string;
}

export interface OnPageResult {
  ok: boolean;
  sourceUrl: string;
  finalUrl: string;
  canonicalUrl: string;
  statusCode: number | null;
  title: string;
  metaDescription: string;
  headings: string[];
  text: string;
  html: string;
  internalLinks: OnPageLink[];
  externalLinks: OnPageLink[];
  usedJavaScript: boolean;
  error?: string;
}

export interface ContentAnalysisResult {
  ok: boolean;
  summary: string;
  sponsorshipSignals: string[];
  pricingSignals: string[];
  contactSignals: string[];
  opportunityType: string;
  hasSponsorshipOpportunity: boolean;
  cheapestTierWithLink: string;
  error?: string;
}

function extractTextFromUnknown(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function extractLinks(v: unknown): OnPageLink[] {
  if (!Array.isArray(v)) return [];
  const out: OnPageLink[] = [];
  for (const entry of v) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    const url = extractTextFromUnknown(rec.url || rec.href);
    if (!url) continue;
    const anchor = extractTextFromUnknown(rec.anchor || rec.text || rec.title);
    out.push({ url, anchor });
  }
  return out;
}

function findFirstString(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = obj[k];
    const text = extractTextFromUnknown(val);
    if (text) return text;
  }
  return "";
}

export async function onPageAnalyzeUrl(
  url: string,
  opts?: { useJavaScript?: boolean },
): Promise<OnPageResult> {
  const useJavaScript = !!opts?.useJavaScript;
  const payload = [{
    url,
    load_resources: useJavaScript,
    enable_javascript: useJavaScript,
  }];

  const res = await fetch("https://api.dataforseo.com/v3/on_page/instant_pages", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return {
      ok: false,
      sourceUrl: url,
      finalUrl: url,
      canonicalUrl: "",
      statusCode: null,
      title: "",
      metaDescription: "",
      headings: [],
      text: "",
      html: "",
      internalLinks: [],
      externalLinks: [],
      usedJavaScript: useJavaScript,
      error: `DataForSEO OnPage HTTP ${res.status}`,
    };
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      sourceUrl: url,
      finalUrl: url,
      canonicalUrl: "",
      statusCode: null,
      title: "",
      metaDescription: "",
      headings: [],
      text: "",
      html: "",
      internalLinks: [],
      externalLinks: [],
      usedJavaScript: useJavaScript,
      error: `DataForSEO OnPage parse error: ${err.slice(0, 200)}`,
    };
  }

  const tasks = Array.isArray(json.tasks) ? json.tasks : [];
  const task = (tasks[0] as Record<string, unknown> | undefined) ?? {};
  const results = Array.isArray(task.result) ? task.result : [];
  const page = (results[0] as Record<string, unknown> | undefined) ?? {};
  const pageData = (page.page as Record<string, unknown> | undefined) ?? page;

  const finalUrl = findFirstString(pageData, ["final_url", "url", "page_url"]) || url;
  const canonicalUrl = findFirstString(pageData, ["canonical", "canonical_url"]);
  const title = findFirstString(pageData, ["title", "meta_title"]);
  const metaDescription = findFirstString(pageData, ["description", "meta_description"]);
  const html = findFirstString(pageData, ["html", "content"]);
  const text = findFirstString(pageData, ["plain_text", "text", "content_text"]);
  const headingsRaw = pageData.headings;
  const headings = Array.isArray(headingsRaw)
    ? headingsRaw.map((h) => extractTextFromUnknown(h)).filter(Boolean)
    : [];

  const internalLinks = extractLinks(pageData.internal_links || pageData.links_internal);
  const externalLinks = extractLinks(pageData.external_links || pageData.links_external);
  const statusCodeRaw = pageData.status_code;
  const statusCode = typeof statusCodeRaw === "number" ? statusCodeRaw : Number(statusCodeRaw ?? NaN);

  return {
    ok: true,
    sourceUrl: url,
    finalUrl,
    canonicalUrl,
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    title,
    metaDescription,
    headings,
    text,
    html,
    internalLinks,
    externalLinks,
    usedJavaScript: useJavaScript,
  };
}

export async function contentAnalyze(
  url: string,
  text: string,
): Promise<ContentAnalysisResult> {
  const payload = [{
    url,
    content: text.slice(0, 15000),
    language_code: "en",
  }];

  const res = await fetch("https://api.dataforseo.com/v3/content_analysis/summary/live", {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return {
      ok: false,
      summary: "",
      sponsorshipSignals: [],
      pricingSignals: [],
      contactSignals: [],
      opportunityType: "Unknown",
      hasSponsorshipOpportunity: false,
      cheapestTierWithLink: "Unknown",
      error: `DataForSEO Content Analysis HTTP ${res.status}`,
    };
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      summary: "",
      sponsorshipSignals: [],
      pricingSignals: [],
      contactSignals: [],
      opportunityType: "Unknown",
      hasSponsorshipOpportunity: false,
      cheapestTierWithLink: "Unknown",
      error: `DataForSEO Content Analysis parse error: ${err.slice(0, 200)}`,
    };
  }

  const tasks = Array.isArray(json.tasks) ? json.tasks : [];
  const task = (tasks[0] as Record<string, unknown> | undefined) ?? {};
  const results = Array.isArray(task.result) ? task.result : [];
  const summaryRec = (results[0] as Record<string, unknown> | undefined) ?? {};
  const summary = findFirstString(summaryRec, ["summary", "text", "content_summary"]);

  const lower = `${summary} ${text}`.toLowerCase();
  const sponsorshipSignals = [
    "sponsor",
    "sponsorship",
    "become a sponsor",
    "sponsorship opportunities",
    "partner with us",
    "vendor and sponsor",
    "advertise with us",
  ].filter((t) => lower.includes(t));
  const pricingSignals = ["$", "tier", "package", "pricing", "contact for pricing"].filter((t) => lower.includes(t));
  const contactSignals = ["contact", "email", "apply", "submission", "deadline"].filter((t) => lower.includes(t));
  const hasSponsorshipOpportunity = sponsorshipSignals.length > 0;

  return {
    ok: true,
    summary,
    sponsorshipSignals,
    pricingSignals,
    contactSignals,
    opportunityType: hasSponsorshipOpportunity ? "SponsorshipOpportunityPage" : "Unknown",
    hasSponsorshipOpportunity,
    cheapestTierWithLink: "Unknown",
  };
}

export async function serpQuery(opts: SerpQueryOptions): Promise<SerpResult[]> {
  const depth = opts.depth ?? 30;
  const location_code = opts.location_code ?? 2840;
  const language_code = opts.language_code ?? "en";

  const body = [
    {
      keyword: opts.query,
      location_code,
      language_code,
      depth,
    },
  ];

  const res = await fetch(
    "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(
      `DataForSEO HTTP ${res.status}: ${await res.text().catch(() => "")}`,
    );
  }

  let json: DataForSeoResponse;
  try {
    json = (await res.json()) as DataForSeoResponse;
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new Error(`DataForSEO JSON parse error: ${err.slice(0, 300)}`);
  }

  const task = json.tasks?.[0];
  if (!task || (task.status_code && task.status_code >= 40000)) {
    throw new Error(
      `DataForSEO task error ${task?.status_code}: ${task?.status_message ?? "unknown"}`,
    );
  }

  const items = task.result?.[0]?.items ?? [];
  const results: SerpResult[] = [];
  for (const it of items) {
    if (it.type !== "organic") continue;
    if (!it.url) continue;
    results.push({
      title: it.title ?? "",
      url: it.url,
      root_domain: rootDomain(it.url),
      rank: it.rank_absolute ?? it.rank_group ?? 0,
      snippet: it.description ?? "",
      breadcrumb: it.breadcrumb ?? "",
      serp_result_type: it.type ?? "",
      search_query_used: opts.query,
      target_city: opts.target_city,
      target_state: opts.target_state,
    });
  }
  return results;
}
