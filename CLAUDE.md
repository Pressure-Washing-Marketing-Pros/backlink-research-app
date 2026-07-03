# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project goal

Sponsorship backlink research system. Discovers and evaluates sponsorship-style link opportunities by combining Google SERP results (DataForSEO) with domain authority metrics (Ahrefs), applying a documented decision-logic SOP, and exporting qualified prospects to CSV. Deploy target is Vercel.

## Tech stack

- Next.js 16 (App Router, Turbopack)
- TypeScript
- Tailwind CSS v4 (via `@tailwindcss/postcss`)
- ESLint 9 with `eslint-config-next`
- npm; no `src/` directory; import alias `@/*`

## Commands

- `npm run dev` — dev server (Turbopack)
- `npm run build` — production build
- `npm run start` — serve production build
- `npm run lint` — ESLint
- `npm test` — rule-based validation cases for the strict page analyzer (`scripts/validateAnalysis.ts`)
- `npm run migrate` — apply idempotent schema statements to Neon Postgres

## Required environment variables

Put these in `.env.local` (gitignored) for local dev, and mirror them in Vercel Project Settings → Environment Variables for deployment. They must only be read from Route Handlers / Server Components — never expose to the client.

- `DATAFORSEO_LOGIN` — DataForSEO account login (used in Basic auth)
- `DATAFORSEO_PASSWORD` — DataForSEO account password (used in Basic auth)
- `AHREFS_API_TOKEN` — Ahrefs API bearer token
- `DATABASE_URL` — Neon Postgres (inventory + crawl cache)
- `ANTHROPIC_API_KEY` — Anthropic Claude API key (required for Claude scraping strategy)

Optional scraping & tuning (defaults live in `lib/sponsorshipConfig.ts` and `lib/scrape-strategy.ts`):

- `SCRAPE_STRATEGY` — page scraping backend (default: `claude-fallback`)
  - `firecrawl` — Firecrawl only (1,000 pages/mo free, 2 concurrent)
  - `claude` — Claude only (no monthly limit, higher concurrency)
  - `claude-fallback` — Try Firecrawl first, fall back to Claude on failure
- `FIRECRAWL_API_KEY` — Firecrawl API key (only needed if using Firecrawl strategy)
- `FIRECRAWL_MAX_URLS_PER_RUN` — per-run scrape cap (default 50)
- `CRAWL_CACHE_TTL_DAYS` — successful-crawl reuse window in days (default 60)

## Research pipeline (strict scrape-and-match)

`lib/runResearch.ts` orders stages so paid APIs are spent last:
DataForSEO SERP → URL normalize + dedup (`lib/urlNormalize.ts`) → spam-domain
reject → Ahrefs DR gate (DR ≥ 25, `lib/sponsorshipConfig.ts`) → page scraping
(`lib/firecrawl.ts` or `lib/claude-scraper.ts`, with 60-day cache) → strict
keyword/price matching on scraped content (`lib/pageAnalysis.ts`). 

**Scraping strategies** (`lib/scrape-strategy.ts`):
- **Firecrawl** (default legacy): Static HTML extraction, 1,000 pages/mo free, 2 concurrent
- **Claude** (new): HTML → semantic analysis + decision logic in one call, higher concurrency, token-based pricing
- **Claude-fallback** (recommended): Try Firecrawl first, fall back to Claude on failure

Approval is never based on SERP titles/snippets or URL text — only scraped page content + DR. Missing core data always routes to review, never to approve.

## External inputs (provided, not yet wired up)

The user supplies these — when added to the repo, update this section with exact paths:

- **Sponsorship SOP** — workflow rules for qualifying sponsorship backlink prospects
- **SKILL.md** — decision logic for grading / filtering prospects
- **Query bank** — list of search queries fed into DataForSEO SERP

## Version 1 scope

1. Load query bank → submit Google SERP tasks to DataForSEO
2. Collect ranking URLs + root domains from SERP results
3. Enrich each domain with Ahrefs metrics (DR, organic traffic, referring domains, etc.)
4. Apply Sponsorship SOP + SKILL.md decision logic to qualify / disqualify each prospect
5. Render results in a sortable, filterable table UI
6. Export qualified prospects to CSV

Out of scope for v1: outreach tracking, multi-user auth, persistent database, scheduled re-runs.
