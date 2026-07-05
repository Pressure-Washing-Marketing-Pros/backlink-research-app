import "server-only";
import type { AhrefsErrorCategory, AhrefsMetrics } from "@/lib/types";

const BASE = "https://api.ahrefs.com/v3";

class AhrefsApiError extends Error {
  category: AhrefsErrorCategory;
  rawResponsePreview?: string;
  constructor(message: string, category: AhrefsErrorCategory, rawResponsePreview?: string) {
    super(message);
    this.category = category;
    this.rawResponsePreview = rawResponsePreview;
  }
}

function authHeader(): string {
  const token = process.env.AHREFS_API_TOKEN;
  if (!token) {
    throw new AhrefsApiError(
      "AHREFS_API_TOKEN is missing or empty in this environment",
      "api_key_missing",
    );
  }
  return `Bearer ${token}`;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function ahrefsGet(pathAndQuery: string, attempt = 0): Promise<unknown> {
  const res = await fetch(`${BASE}${pathAndQuery}`, {
    method: "GET",
    headers: {
      Authorization: authHeader(),
      Accept: "application/json",
    },
  });
  // Ahrefs rate-limits aggressively; one retry after a short backoff clears
  // most transient 429s (also keep caller concurrency low).
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
    return ahrefsGet(pathAndQuery, attempt + 1);
  }
  if (res.status === 429) {
    throw new AhrefsApiError(
      `Ahrefs rate limit exceeded (HTTP 429) after retries`,
      "rate_limited",
      (await res.text().catch(() => "")).slice(0, 300),
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AhrefsApiError(
      `Ahrefs request failed: HTTP ${res.status}`,
      "request_failed",
      body.slice(0, 300),
    );
  }

  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new AhrefsApiError(
      `Ahrefs response could not be parsed as JSON: ${err.slice(0, 200)}`,
      "response_mapping_failed",
      text.slice(0, 300),
    );
  }
}

function toFiniteNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickNumber(obj: unknown, keys: string[]): number | null {
  if (obj === null || obj === undefined) return null;

  const direct = toFiniteNumber(obj);
  if (direct !== null) return direct;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const inner = pickNumber(item, keys);
      if (inner !== null) return inner;
    }
    return null;
  }

  if (typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // Prefer explicit key matches first.
  for (const k of keys) {
    if (!(k in o)) continue;
    const n = toFiniteNumber(o[k]);
    if (n !== null) return n;
    const inner = pickNumber(o[k], keys);
    if (inner !== null) return inner;
  }

  // Fallback: deep walk all nested properties for the same keys.
  for (const value of Object.values(o)) {
    const inner = pickNumber(value, keys);
    if (inner !== null) return inner;
  }

  return null;
}

interface TaggedFailure {
  __error: string;
  __category: AhrefsErrorCategory;
  __raw?: string;
}

function toTaggedFailure(e: unknown): TaggedFailure {
  if (e instanceof AhrefsApiError) {
    return { __error: e.message, __category: e.category, __raw: e.rawResponsePreview };
  }
  return {
    __error: e instanceof Error ? e.message : String(e),
    __category: "request_failed",
  };
}

function isTaggedFailure(v: unknown): v is TaggedFailure {
  return !!v && typeof v === "object" && "__error" in v;
}

export async function domainMetrics(domain: string): Promise<AhrefsMetrics> {
  const checkedAt = new Date().toISOString();
  const targetUsed = domain;

  if (!domain || !domain.trim()) {
    return {
      dr: null,
      organic_traffic: null,
      referring_domains: null,
      error: "No domain was provided to Ahrefs (empty root domain)",
      errorCategory: "invalid_domain",
      status: "failed",
      checkedAt,
      targetUsed,
    };
  }
  // A full URL (with scheme/path) sent as "domain" is a caller bug — Ahrefs
  // expects a bare root domain (e.g. "example.com"), not "https://example.com/page".
  if (/^https?:\/\//i.test(domain) || domain.includes("/")) {
    return {
      dr: null,
      organic_traffic: null,
      referring_domains: null,
      error: `Expected a root domain but received "${domain}" — looks like a full URL or path was passed instead`,
      errorCategory: "invalid_domain",
      status: "failed",
      checkedAt,
      targetUsed,
    };
  }

  const date = today();
  const target = encodeURIComponent(domain);
  const drPathWithDate = `/site-explorer/domain-rating?target=${target}&mode=domain&date=${date}`;
  const metricsPathWithDate = `/site-explorer/metrics?target=${target}&mode=domain&date=${date}`;
  const drPathNoDate = `/site-explorer/domain-rating?target=${target}&mode=domain`;
  const metricsPathNoDate = `/site-explorer/metrics?target=${target}&mode=domain`;

  try {
    let [drJson, metricsJson] = await Promise.all([
      ahrefsGet(drPathWithDate).catch(toTaggedFailure),
      ahrefsGet(metricsPathWithDate).catch(toTaggedFailure),
    ]);

    // Once the API key itself is the problem, retrying without a date won't
    // help — every subsequent call would fail identically, so bail out early
    // instead of doubling the (already-failing) request count.
    const drFailedInitial = isTaggedFailure(drJson);
    const metricsFailedInitial = isTaggedFailure(metricsJson);
    const authFailure =
      (isTaggedFailure(drJson) && drJson.__category === "api_key_missing") ||
      (isTaggedFailure(metricsJson) && metricsJson.__category === "api_key_missing");

    // Some domains/date snapshots fail for "today" even though Ahrefs has
    // data. Retry once without date to fetch the latest available snapshot.
    if (!authFailure && (drFailedInitial || metricsFailedInitial)) {
      const [drNoDate, metricsNoDate] = await Promise.all([
        drFailedInitial ? ahrefsGet(drPathNoDate).catch(toTaggedFailure) : Promise.resolve(drJson),
        metricsFailedInitial ? ahrefsGet(metricsPathNoDate).catch(toTaggedFailure) : Promise.resolve(metricsJson),
      ]);
      drJson = drNoDate;
      metricsJson = metricsNoDate;
    }

    const dr = isTaggedFailure(drJson) ? null : pickNumber(drJson, ["domain_rating"]);
    const organic_traffic = isTaggedFailure(metricsJson)
      ? null
      : pickNumber(metricsJson, ["org_traffic", "organic_traffic", "organic_search_traffic", "traffic"]);
    const referring_domains = isTaggedFailure(metricsJson)
      ? null
      : pickNumber(metricsJson, ["refdomains", "referring_domains", "ref_domains"]);

    const drFailure = isTaggedFailure(drJson) ? drJson : null;
    const metricsFailure = isTaggedFailure(metricsJson) ? metricsJson : null;

    if (drFailure || metricsFailure) {
      const errs = [
        drFailure && `dr: ${drFailure.__error}`,
        metricsFailure && `metrics: ${metricsFailure.__error}`,
      ].filter(Boolean);
      const category = drFailure?.__category ?? metricsFailure?.__category ?? "request_failed";
      const rawPreview = drFailure?.__raw ?? metricsFailure?.__raw;
      return {
        dr,
        organic_traffic,
        referring_domains,
        error: errs.join("; "),
        errorCategory: category,
        status: "failed",
        checkedAt,
        targetUsed,
        rawResponsePreview: rawPreview,
      };
    }

    // Both requests succeeded, but neither response contained a recognizable
    // numeric field — Ahrefs returned data, just not what we expected to find.
    if (dr === null && organic_traffic === null) {
      return {
        dr: null,
        organic_traffic: null,
        referring_domains,
        error: "Ahrefs returned a successful response with no domain_rating/traffic fields for this domain",
        errorCategory: "no_data_returned",
        status: "failed",
        checkedAt,
        targetUsed,
        rawResponsePreview: JSON.stringify({ drJson, metricsJson }).slice(0, 500),
      };
    }

    return {
      dr,
      organic_traffic,
      referring_domains,
      status: "success",
      checkedAt,
      targetUsed,
    };
  } catch (e) {
    const failure = toTaggedFailure(e);
    return {
      dr: null,
      organic_traffic: null,
      referring_domains: null,
      error: failure.__error,
      errorCategory: failure.__category,
      status: "failed",
      checkedAt,
      targetUsed,
      rawResponsePreview: failure.__raw,
    };
  }
}

export async function domainMetricsBatch(
  domains: string[],
  concurrency = 5,
): Promise<Map<string, AhrefsMetrics>> {
  const out = new Map<string, AhrefsMetrics>();
  let i = 0;
  async function worker() {
    while (i < domains.length) {
      const idx = i++;
      const d = domains[idx];
      if (out.has(d)) continue;
      out.set(d, await domainMetrics(d));
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, domains.length) }, () => worker());
  await Promise.all(workers);
  return out;
}
