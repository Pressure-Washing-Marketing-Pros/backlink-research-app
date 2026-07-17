import "server-only";

export type ScrapeStrategy = "firecrawl" | "claude" | "claude-fallback";

/**
 * Get the active scrape strategy from environment or config.
 * SCRAPE_STRATEGY env var controls which strategy to use:
 * - "firecrawl": Use Firecrawl only
 * - "claude": Use Claude only
 * - "claude-fallback": Try Firecrawl first, fall back to Claude on failure (default)
 */
export function getScrapeStrategy(): ScrapeStrategy {
  const env = process.env.SCRAPE_STRATEGY?.toLowerCase();
  if (env === "firecrawl") return "firecrawl";
  if (env === "claude") return "claude";
  return "claude-fallback";
}

export interface ScrapeConfig {
  strategy: ScrapeStrategy;
  /** Max concurrent requests (Firecrawl free: 2, Claude has higher limits) */
  concurrency: number;
  /** Max URLs to scrape in a single run to keep request time bounded. */
  maxUrlsPerRun: number;
  /** Enable caching layer */
  cacheEnabled: boolean;
  /** Cache TTL in days */
  cacheTtlDays: number;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getConfig(): ScrapeConfig {
  const strategy = getScrapeStrategy();
  const firecrawlCap = positiveInt(process.env.FIRECRAWL_MAX_URLS_PER_RUN, 50);
  const claudeCap = positiveInt(process.env.CLAUDE_MAX_URLS_PER_RUN, 10);
  const fallbackCap = positiveInt(process.env.CLAUDE_FALLBACK_MAX_URLS_PER_RUN, 20);

  return {
    strategy,
    // Keep concurrency conservative for serverless time budgets.
    concurrency: strategy === "claude" ? 2 : 2,
    maxUrlsPerRun:
      strategy === "claude"
        ? claudeCap
        : strategy === "claude-fallback"
          ? fallbackCap
          : firecrawlCap,
    cacheEnabled: true,
    cacheTtlDays: Number(process.env.CRAWL_CACHE_TTL_DAYS) || 60,
  };
}

/**
 * Factory: return the appropriate scraper based on config.
 * Imports are lazy to avoid loading unused API clients.
 */
export async function createScraper(strategy: ScrapeStrategy) {
  if (strategy === "claude") {
    const { scrapeWithClaude } = await import("@/lib/claude-scraper");
    return { scrapeUrl: scrapeWithClaude, name: "Claude" };
  }
  if (strategy === "claude-fallback") {
    const { scrapeUrl: firecrawlScrape } = await import("@/lib/firecrawl");
    const { scrapeWithClaude } = await import("@/lib/claude-scraper");
    return {
      async scrapeUrl(url: string) {
        const result = await firecrawlScrape(url);
        if (!result.ok && result.cacheable) {
          console.log(`[scraper] Firecrawl failed, falling back to Claude: ${url}`);
          return scrapeWithClaude(url);
        }
        return result;
      },
      name: "Firecrawl+Claude",
    };
  }
  // Default: Firecrawl only
  const { scrapeUrl } = await import("@/lib/firecrawl");
  return { scrapeUrl, name: "Firecrawl" };
}
