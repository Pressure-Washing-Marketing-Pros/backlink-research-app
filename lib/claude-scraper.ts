import "server-only";
import type { SponsorshipCrawlResult } from "@/lib/types";

const ANTHROPIC_API_ENDPOINT = "https://api.anthropic.com/v1/messages";

export interface ClaudeScrapResult {
  ok: boolean;
  status: number;
  pageTitle: string;
  finalUrl: string;
  markdown: string;
  error?: string;
  /**
   * false when the failure is config/quota related (missing key, rate limit)
   * — those should not be cached against the URL.
   */
  cacheable: boolean;
}

function fail(
  status: number,
  error: string,
  url: string,
  cacheable = true,
): ClaudeScrapResult {
  return { ok: false, status, pageTitle: "", finalUrl: url, markdown: "", error, cacheable };
}

/**
 * Fetch HTML from URL using a simple HEAD/GET. Claude will handle redirects.
 */
async function fetchHtml(url: string, attempt = 0): Promise<string> {
  const signal = AbortSignal.timeout(15000);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
    signal,
  });

  if (!res.ok && attempt < 1) {
    await new Promise((r) => setTimeout(r, 1000));
    return fetchHtml(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  }

  return res.text();
}

/**
 * Use Claude to analyze HTML and extract sponsorship opportunity info.
 * Returns structured data matching SponsorshipCrawlResult.
 */
export async function scrapeWithClaude(url: string): Promise<ClaudeScrapResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return fail(0, "Missing ANTHROPIC_API_KEY in environment", url, false);
  }

  let html = "";
  try {
    html = await fetchHtml(url);
    if (!html || html.length < 100) {
      return fail(0, "HTML fetch returned empty or too short", url, false);
    }
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return fail(0, `Failed to fetch HTML: ${err.slice(0, 300)}`, url);
  }

  // Truncate HTML to ~200KB to avoid token overflow
  const truncatedHtml = html.slice(0, 200000);

  const systemPrompt = `You are an expert sponsorship opportunity analyst. Your task is to:
1. Analyze HTML from a webpage to determine if it offers a sponsorship opportunity
2. Extract structured data about the opportunity (if it exists)
3. Return JSON (no markdown, no backticks)

Focus on:
- Page purpose (is this a page where you can APPLY for sponsorship?)
- Sponsorship terms present (sponsor, partnership, vendor, exhibitor, donor, etc.)
- Website link evidence (can sponsors get a website link, logo link, sponsor listing, etc.?)
- Pricing/cost information ($ amounts, packages, tiers)
- Page title and final URL
- Conversion to clean markdown (remove scripts, styles, navigation cruft)

Return JSON with this EXACT structure:
{
  "pageTitle": "string",
  "finalUrl": "string (same as input URL)",
  "markdown": "string (clean, readable markdown of main content)",
  "sponsorshipTerms": ["array of sponsorship-related terms found"],
  "backlinkTerms": ["array of website link evidence terms"],
  "pricingTerms": ["array of pricing-related terms"],
  "prices": [array of detected prices as numbers],
  "lowestPrice": number or null,
  "pagePurpose": "SponsorshipOpportunityPage|SponsorPacketOrForm|DonationOrPartnerPage|VendorOrExhibitorOpportunityPage|BlogArticle|JobPosting|TravelOrReviewPage|ForumThread|Unknown"
}

DO NOT return markdown code blocks. Return ONLY the JSON object.`;

  try {
    const response = await fetch(ANTHROPIC_API_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 2000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Analyze this HTML and extract sponsorship opportunity data:\n\n${truncatedHtml}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const quotaOrRate = response.status === 429 || response.status === 401;
      return fail(
        response.status,
        `Claude HTTP ${response.status}: ${errorText.slice(0, 300)}`,
        url,
        !quotaOrRate,
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return fail(response.status, `Claude response JSON parse error: ${err.slice(0, 300)}`, url, false);
    }

    const data = json as {
      content?: Array<{ type?: string; text?: string }>;
      error?: { message?: string };
    };

    if (data.error) {
      return fail(response.status, `Claude error: ${data.error.message}`, url, false);
    }

    const content = data.content?.[0];
    if (!content || content.type !== "text") {
      return fail(response.status, "Claude returned no text content", url, false);
    }

    let analysis: {
      pageTitle?: string;
      finalUrl?: string;
      markdown?: string;
      sponsorshipTerms?: string[];
      backlinkTerms?: string[];
      pricingTerms?: string[];
      prices?: number[];
      lowestPrice?: number | null;
      pagePurpose?: string;
    };

    try {
      // Claude might wrap in markdown code block despite instructions
      let text = content.text ?? "";
      text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      analysis = JSON.parse(text);
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      return fail(
        response.status,
        `Failed to parse Claude analysis: ${err.slice(0, 200)}. Raw: ${content.text?.slice(0, 200)}`,
        url,
        false,
      );
    }

    return {
      ok: true,
      status: response.status,
      pageTitle: analysis.pageTitle ?? "",
      finalUrl: analysis.finalUrl ?? url,
      markdown: analysis.markdown ?? "",
      cacheable: true,
    };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return fail(0, `Claude scrape error: ${err.slice(0, 300)}`, url);
  }
}

/**
 * Alternative: Use Claude to do both scraping AND analysis in one call.
 * Returns the full SponsorshipCrawlResult directly (minus contact info).
 */
export async function analyzeWithClaude(
  url: string,
  pageTitle: string,
  markdown: string,
): Promise<Partial<SponsorshipCrawlResult> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const systemPrompt = `You are a sponsorship opportunity analyst. Analyze this page content and return JSON ONLY (no markdown, no backticks).

Extract:
- Page purpose classification
- Sponsorship intent indicators (sponsor, partnership, vendor, etc.)
- Website link/backlink evidence
- Pricing information and budget
- Local relevance (High/Medium/Low)
- Link opportunity status (Confirmed/Probable/Unclear)

Return JSON with this EXACT structure:
{
  "opportunityType": "SponsorshipOpportunityPage|SponsorPacketOrForm|DonationOrPartnerPage|VendorOrExhibitorOpportunityPage|Unknown",
  "linkOpportunityStatus": "Confirmed|Probable|Unclear|No Link Opportunity",
  "linkEvidence": "string describing the evidence",
  "paymentAmount": "string like '250-500' or 'tiered' or 'unknown'",
  "paymentType": "One-Time|Annual|Monthly|Recurring|Unknown",
  "currentSponsorsDisplayedPublicly": "Yes|No|Unknown",
  "currentSponsorsLinked": "Yes|No|Unknown",
  "localRelevance": "High|Medium|Low|Unknown"
}`;

  try {
    const response = await fetch(ANTHROPIC_API_ENDPOINT, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1000,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: `Page: ${pageTitle}\n\nContent:\n${markdown.slice(0, 20000)}`,
          },
        ],
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const content = data.content?.[0];
    if (!content || content.type !== "text") return null;

    let text = content.text ?? "";
    text = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
    const analysis = JSON.parse(text) as Partial<SponsorshipCrawlResult>;
    return analysis;
  } catch {
    return null;
  }
}
