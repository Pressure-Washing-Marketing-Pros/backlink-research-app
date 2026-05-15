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

## Required environment variables

Put these in `.env.local` (gitignored) for local dev, and mirror them in Vercel Project Settings → Environment Variables for deployment. They must only be read from Route Handlers / Server Components — never expose to the client.

- `DATAFORSEO_LOGIN` — DataForSEO account login (used in Basic auth)
- `DATAFORSEO_PASSWORD` — DataForSEO account password (used in Basic auth)
- `AHREFS_API_TOKEN` — Ahrefs API bearer token

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
