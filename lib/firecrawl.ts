import "server-only";

// Firecrawl scraping client, tuned for the free plan (1,000 pages/month,
// 2 concurrent requests, low rate limits):
// - callers must keep concurrency at FIRECRAWL_CONCURRENCY (2)
// - one retry maximum, with a short backoff
// - never throws; failures come back as { ok: false } so the pipeline can
//   route the URL to human review instead of dropping it

const FIRECRAWL_ENDPOINT = "https://api.firecrawl.dev/v1/scrape";
const SCRAPE_TIMEOUT_MS = 30000;

export interface FirecrawlResult {
  ok: boolean;
  status: number;
  pageTitle: string;
  finalUrl: string;
  markdown: string;
  error?: string;
  /**
   * false when the failure is config/quota related (missing key, 402 out of
   * credits, 429 rate limit) — those should not be cached against the URL,
   * since the page itself may be fine.
   */
  cacheable: boolean;
}

function fail(
  status: number,
  error: string,
  url: string,
  cacheable = true,
): FirecrawlResult {
  return { ok: false, status, pageTitle: "", finalUrl: url, markdown: "", error, cacheable };
}

async function attemptScrape(url: string, key: string): Promise<FirecrawlResult> {
  const res = await fetch(FIRECRAWL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      formats: ["markdown"],
      onlyMainContent: true,
      timeout: SCRAPE_TIMEOUT_MS,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const quotaOrRate = res.status === 402 || res.status === 429;
    return fail(
      res.status,
      `Firecrawl HTTP ${res.status}: ${text.slice(0, 300)}`,
      url,
      !quotaOrRate,
    );
  }

  let json: {
    success?: boolean;
    error?: string;
    data?: {
      markdown?: string;
      metadata?: { title?: string; sourceURL?: string; url?: string };
    };
  };

  try {
    json = (await res.json()) as {
      success?: boolean;
      error?: string;
      data?: {
        markdown?: string;
        metadata?: { title?: string; sourceURL?: string; url?: string };
      };
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return fail(res.status, `Firecrawl JSON parse error: ${err.slice(0, 300)}`, url, false);
  }

  if (!json.success || !json.data) {
    return fail(res.status, `Firecrawl error: ${json.error ?? "no data returned"}`, url);
  }

  const meta = json.data.metadata ?? {};
  return {
    ok: true,
    status: res.status,
    pageTitle: meta.title ?? "",
    finalUrl: meta.url || meta.sourceURL || url,
    markdown: json.data.markdown ?? "",
    cacheable: true,
  };
}

export async function scrapeUrl(url: string): Promise<FirecrawlResult> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) {
    return fail(0, "Missing FIRECRAWL_API_KEY in environment", url, false);
  }

  let last: FirecrawlResult = fail(0, "not attempted", url);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await attemptScrape(url, key);
    } catch (e) {
      last = fail(0, e instanceof Error ? e.message : String(e), url);
    }
    if (last.ok) break;
    if (last.status === 402) break; // out of credits — retrying won't help
    if (attempt === 0) {
      await new Promise((r) => setTimeout(r, last.status === 429 ? 5000 : 2000));
    }
  }
  return last;
}
