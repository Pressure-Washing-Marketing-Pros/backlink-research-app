import "server-only";
import type { AhrefsMetrics } from "@/lib/types";

const BASE = "https://api.ahrefs.com/v3";

function authHeader(): string {
  const token = process.env.AHREFS_API_TOKEN;
  if (!token) throw new Error("Missing AHREFS_API_TOKEN in environment");
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
  if (!res.ok) {
    throw new Error(`Ahrefs HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  try {
    return await res.json();
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    throw new Error(`Ahrefs JSON parse error: ${err.slice(0, 300)}`);
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

export async function domainMetrics(domain: string): Promise<AhrefsMetrics> {
  if (!domain) {
    return { dr: null, organic_traffic: null, referring_domains: null, error: "empty domain" };
  }

  const date = today();
  const target = encodeURIComponent(domain);

  try {
    const [drJson, metricsJson] = await Promise.all([
      ahrefsGet(`/site-explorer/domain-rating?target=${target}&mode=domain&date=${date}`).catch(
        (e: Error) => ({ __error: e.message }),
      ),
      ahrefsGet(`/site-explorer/metrics?target=${target}&mode=domain&date=${date}`).catch(
        (e: Error) => ({ __error: e.message }),
      ),
    ]);

    const dr = pickNumber(drJson, ["domain_rating"]);
    const organic_traffic = pickNumber(metricsJson, [
      "org_traffic",
      "organic_traffic",
      "organic_search_traffic",
      "traffic",
    ]);
    const referring_domains = pickNumber(metricsJson, [
      "refdomains",
      "referring_domains",
      "ref_domains",
    ]);

    const errs: string[] = [];
    if (drJson && typeof drJson === "object" && "__error" in drJson) {
      errs.push(`dr: ${(drJson as { __error: string }).__error}`);
    }
    if (metricsJson && typeof metricsJson === "object" && "__error" in metricsJson) {
      errs.push(`metrics: ${(metricsJson as { __error: string }).__error}`);
    }

    return {
      dr,
      organic_traffic,
      referring_domains,
      error: errs.length > 0 ? errs.join("; ") : undefined,
    };
  } catch (e) {
    return {
      dr: null,
      organic_traffic: null,
      referring_domains: null,
      error: e instanceof Error ? e.message : String(e),
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
