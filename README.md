# Sponsorship Backlink Research App

Research and qualify sponsorship backlink opportunities by combining Google SERP discovery (DataForSEO), domain metrics (Ahrefs), and strict page-level analysis.

## Stack

- Next.js 16 (App Router)
- TypeScript
- Tailwind CSS v4
- Neon Postgres (inventory + crawl cache)

## Features

- Query-bank driven SERP discovery
- URL/domain dedup and hard pre-filters
- Ahrefs DR gating before scraping
- Strategy-based scraping: Firecrawl, Claude, or Claude-fallback
- Strict decision engine: Approve / Needs Human Review / Reject
- Inventory dashboard with filters, sorting, refresh, and CSV export

## Required Environment Variables

Set these in .env.local for local development:

DATAFORSEO_LOGIN=your-dataforseo-login
DATAFORSEO_PASSWORD=your-dataforseo-password
AHREFS_API_TOKEN=your-ahrefs-api-token
DATABASE_URL=your-neon-database-url

Strategy-dependent scraping keys:

- If SCRAPE_STRATEGY=firecrawl: set FIRECRAWL_API_KEY
- If SCRAPE_STRATEGY=claude: set ANTHROPIC_API_KEY
- If SCRAPE_STRATEGY=claude-fallback: set at least one of FIRECRAWL_API_KEY or ANTHROPIC_API_KEY

Optional:

SCRAPE_STRATEGY=claude-fallback
FIRECRAWL_MAX_URLS_PER_RUN=50
CLAUDE_MAX_URLS_PER_RUN=10
CLAUDE_FALLBACK_MAX_URLS_PER_RUN=20
CRAWL_CACHE_TTL_DAYS=60
MAX_QUERIES_PER_RUN=6
MAX_CANDIDATES_PER_QUERY=8

## Run

npm install
npm run dev

Open http://localhost:3000

## Commands

- npm run dev - start development server
- npm run build - production build
- npm run start - serve production build
- npm run lint - lint checks
- npm test - rule-based analyzer validation
- npm run migrate - apply database schema migrations

## Project Paths

- app/page.tsx - research runner UI
- app/dashboard/page.tsx - sponsorship inventory UI
- app/api/run/route.ts - research run endpoint
- lib/runResearch.ts - end-to-end pipeline
- lib/pageAnalysis.ts - strict decision logic
- lib/queryBank.ts - query bank renderer
- skills/sponsorship/query-bank.csv - source query templates
