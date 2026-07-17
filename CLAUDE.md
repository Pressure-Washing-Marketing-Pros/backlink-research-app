# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project goal

Sponsorship research and database-building system. Discovers local sponsorship opportunities by geographic location using DataForSEO SERP, OnPage, and Content Analysis APIs. Results require human review before approval. Exports qualified prospects to CSV and stores approved/review opportunities in a searchable Sponsorship Repository. Deploy target is Vercel.

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

**Sponsorship Research Pipeline:**
- `DATAFORSEO_LOGIN` — DataForSEO account login (used in Basic auth for SERP, OnPage, Content Analysis)
- `DATAFORSEO_PASSWORD` — DataForSEO account password (used in Basic auth for SERP, OnPage, Content Analysis)
- `DATABASE_URL` — Neon Postgres (Sponsorship Repository + research history)

**Tuning (optional):**
- `SERP_CONCURRENCY` — parallel SERP requests (default: 2)
- `ONPAGE_CONCURRENCY` — parallel OnPage crawls (default: 6)
- `CONTENT_ANALYSIS_CONCURRENCY` — parallel Content Analysis calls (default: 6)
- `MAX_CANDIDATES_PER_QUERY` — max results per SERP query (default: 8)
- `ONPAGE_TIMEOUT_MS` — timeout per OnPage crawl (default: 9,000ms)
- `RUN_TIMEOUT_MS` — overall research run timeout (default: 295,000ms for Vercel 300s function limit)

## Research pipeline (DataForSEO-based sponsorship discovery)

`lib/runResearch.ts` executes this strict order to protect API credits:

1. **Input validation** (`lib/queryBank.ts`) — ensure city, state, state_abbrev are present
2. **Query generation** (`lib/queryBank.ts`) — render full location-based query bank (city-level, county-level, state-level)
3. **SERP retrieval** (`lib/dataforseo.ts` → `serpQuery`) — fetch Google results for all queries
4. **URL normalization + dedup** (`lib/urlNormalize.ts`) — deduplicate URLs across results
5. **Pre-crawl duplicate check** — skip known approved, needs-review, and rejected records
6. **SERP-level relevance filter** (`lib/runResearch.ts` → `isRelevantSerpResult`) — remove obvious non-sponsorship pages before API spend
7. **DataForSEO OnPage crawl** (`lib/dataforseo.ts` → `onPageAnalyzeUrl`) — crawl qualified URLs, with fallback to JavaScript rendering for empty pages
8. **Direct sponsorship page discovery** (`lib/runResearch.ts` → `findBestSponsorshipLink`) — detect sponsor/partnership links, crawl them
9. **Post-crawl duplicate check** — skip redirects and canonical duplicates
10. **DataForSEO Content Analysis** (`lib/dataforseo.ts` → `contentAnalyze`) — extract sponsorship signals, pricing, contact info
11. **Create Needs Review record** — all new opportunities default to human review, never auto-approved
12. **Human review + editing** — reviewer can modify any field before approval
13. **Approval duplicate check** — final check before saving to Sponsorship Repository
14. **Save to database** — store approved or reviewed opportunities

**Decision workflow:**
- No Ahrefs metrics used — location relevance is the primary factor
- No budget filtering — pricing is informational only
- No HTTPS requirement — HTTP pages are acceptable
- No automatic rejections — failed/empty crawls route to human review
- No Firecrawl dependency — uses DataForSEO OnPage exclusively for crawling

## External inputs (current repo paths)

- **Sponsorship SOP** — `skills/sponsorship/SOP.md`
- **SKILL.md** — `skills/sponsorship/SKILL.md`
- **Query bank** — `skills/sponsorship/query-bank.csv` (wired via `lib/queryBank.ts`)

## Version 1 scope

1. Load query bank → submit Google SERP tasks to DataForSEO
2. Collect ranking URLs + root domains from SERP results
3. Enrich each domain with Ahrefs metrics (DR, organic traffic, referring domains, etc.)
4. Apply Sponsorship SOP + SKILL.md decision logic to qualify / disqualify each prospect
5. Render results in a sortable, filterable table UI
6. Export qualified prospects to CSV

Out of scope for v1: outreach tracking, multi-user auth, scheduled re-runs.
