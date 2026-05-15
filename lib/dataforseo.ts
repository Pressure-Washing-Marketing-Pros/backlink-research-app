import "server-only";
import type { SerpResult } from "@/lib/types";

interface DataForSeoOrganicItem {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  url?: string;
  title?: string;
  domain?: string;
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

  const json = (await res.json()) as DataForSeoResponse;
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
      search_query_used: opts.query,
      target_city: opts.target_city,
      target_state: opts.target_state,
    });
  }
  return results;
}
