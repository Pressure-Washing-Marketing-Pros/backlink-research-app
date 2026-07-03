// URL normalization for dedup and cache keys. Generic utility — reusable for
// the future citation research tool. No dependencies, safe in scripts/tests.

const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "ref",
]);

export interface NormalizedUrl {
  /** Stable dedup/cache key: host (no www) + path (no trailing slash) + sorted meaningful query */
  key: string;
  /** Cleaned, still-fetchable URL (original scheme/host preserved, tracking params removed) */
  fetchUrl: string;
}

export function normalizeUrl(raw: string): NormalizedUrl | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;

    u.hash = "";
    for (const param of [...u.searchParams.keys()]) {
      const lower = param.toLowerCase();
      if (lower.startsWith("utm_") || TRACKING_PARAMS.has(lower)) {
        u.searchParams.delete(param);
      }
    }
    u.searchParams.sort();

    const path = u.pathname.replace(/\/+$/, "");
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const query = u.searchParams.toString();
    const key = `${host}${path.toLowerCase()}${query ? `?${query}` : ""}`;

    u.pathname = path || "/";
    return { key, fetchUrl: u.toString() };
  } catch {
    return null;
  }
}
