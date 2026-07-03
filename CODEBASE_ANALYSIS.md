# Sponsorship Backlink Research App — Comprehensive Codebase Analysis

**Date:** July 2, 2026 | **Status:** Production-ready v0.1.0 | **Deployment:** Vercel

---

## 1. Application Purpose & Architecture

### Core Mission

This is a **strict, rule-based sponsorship backlink research system** that discovers and qualifies local sponsorship opportunities where a client's business name, logo, and website can appear on the public-facing pages of local organizations, events, schools, nonprofits, chambers, clubs, and community sites—resulting in real, publicly accessible backlinks.

**Key Constraint:** The application is explicitly *not* looking for pages that merely *talk about* sponsorship. It searches for pages where a business can **actively purchase, request, or apply for sponsorship**. If a page doesn't offer a real opportunity, it is rejected—regardless of domain authority or keyword mentions.

### Architecture Model

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (Next.js 16 App)                    │
│  ├─ app/page.tsx: Research form + results dashboard             │
│  ├─ Client inputs (city, budget, geo modifiers)                 │
│  └─ CSV export + inventory management UI                        │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│              API Endpoints (app/api/*/route.ts)                 │
│  ├─ POST /api/run: Execute research pipeline                   │
│  ├─ GET /api/status: Validate env variables                    │
│  ├─ GET /api/opportunities/search: Query inventory DB           │
│  ├─ POST /api/queries: Preview rendered queries                │
│  ├─ POST /api/research-runs: Store research metadata            │
│  ├─ POST /api/opportunities/save: Persist to inventory          │
│  └─ POST /api/opportunities/[id]/save: Update opportunity      │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│            Core Research Pipeline (lib/runResearch.ts)           │
│  Strict, deterministic 8-stage flow:                            │
│  ├─ Stage 1: DataForSEO SERP queries (30 results per query)    │
│  ├─ Stage 2: URL normalization + domain deduplication           │
│  ├─ Stage 3: Pre-filter (hard rejects: social, blogs, travel)  │
│  ├─ Stage 4: Ahrefs DR gate (DR ≥ 25)                          │
│  ├─ Stage 5: Per-run Firecrawl cap (default 50 URLs)           │
│  ├─ Stage 6: Cache lookup (60-day default)                     │
│  ├─ Stage 7: Firecrawl scrape (free plan: 2 concurrent)        │
│  └─ Stage 8: Strict content analysis → decision                │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│              Decision Logic & Content Analysis                   │
│  ├─ lib/pageAnalysis.ts: Page purpose classification            │
│  ├─ lib/decision.ts: Scoring + sensitivity detection            │
│  ├─ lib/sponsorshipConfig.ts: Keyword groups + thresholds       │
│  └─ Approval requires: DR≥25 + scraped + link evidence +        │
│     in-budget + locally relevant + approvable purpose           │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│              Data Persistence Layer                              │
│  ├─ Neon Postgres (serverless, Vercel-native)                  │
│  ├─ opportunities table: Core inventory (with dedup index)      │
│  ├─ research_runs table: Audit + summaries                      │
│  ├─ crawl_cache table: Firecrawl result cache (dedup + TTL)    │
│  └─ lib/db.ts: Lazy-init SQL client, query builders            │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│                   External API Integrations                      │
│  ├─ DataForSEO: Google SERP results (organic + location)       │
│  ├─ Ahrefs: Domain authority (DR), organic traffic, refs       │
│  └─ Firecrawl: Page scraping (free plan: 1,000/mo, 2 conc)    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 2. Key Components & Responsibilities

### 2.1 Frontend (Client-Side)

**File:** [app/page.tsx](app/page.tsx)

- **Research form** with location targeting fields (city, state, county, metro, service area cities)
- **Budget input** ($ cap for sponsorships)
- **Query preview** showing rendered searches before execution
- **Results dashboard**: inline editable table with decision filters, search, sorting
- **CSV export**: filtered opportunities with all metadata
- **Inventory save**: persist non-rejected opportunities to the DB for future reference

**State Management:**
- Form inputs (location, budget, modifiers)
- Results from `/api/run` (opportunities array + stats)
- Edited rows (client-side edits before save)
- Expanded rows (for viewing full analysis)
- Filters: decision (Approve/Review/Reject), search text, payment type, DR range

### 2.2 API Routes

#### `POST /api/run`
**Purpose:** Trigger the complete 8-stage research pipeline.
- Accepts client inputs (partial `ClientInputs`, validated server-side)
- Returns `RunResult` with `opportunities[]` array and pipeline `stats`
- Timeout: 300s (5 min) for long-running Firecrawl scrapes
- Error handling: 422 for validation errors, 500 for runtime exceptions

#### `GET /api/status`
**Purpose:** Validate that all required environment variables are configured.
- Checks: `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `AHREFS_API_TOKEN`, `FIRECRAWL_API_KEY`
- Returns: `{ ready: boolean, missing: string[], message: string }`

#### `POST /api/queries`
**Purpose:** Preview rendered queries without executing SERP search.
- Input: partial `ClientInputs`
- Output: `RenderedQuery[]` with template substitutions applied
- Useful for UX validation before committing to API spend

#### `GET /api/opportunities/search`
**Purpose:** Search the persistent opportunities inventory (DB).
- Filters: city, state, search text, decision, paymentType, minDr, maxDr
- Sorting: by created, dr, traffic, score; ASC/DESC
- Pagination: limit + offset
- Returns: `{ total, opportunities[], cities, states }`

#### `POST /api/research-runs`
**Purpose:** Record a research run for audit/tracking.
- Stores: client, location, query count, result counts (approved/review/rejected)
- Indexed on: client_name, target_city/state, created_at

#### `POST /api/opportunities/save`
**Purpose:** Bulk insert non-rejected opportunities into inventory.
- Called after user accepts results
- Deduplication: UNIQUE constraint on (domain, sponsorship_url)

#### `POST /api/opportunities/[id]/save`
**Purpose:** Update a single opportunity in inventory.
- Allows inline edits before final save

### 2.3 Research Pipeline: 8-Stage Flow ([lib/runResearch.ts](lib/runResearch.ts))

#### **Stage 1: DataForSEO SERP Queries**
```
Input:  ClientInputs (city, state, county, metro, service_area_cities)
Output: ~1,000–3,000 SerpResult objects
```
- Renders queries from query bank (substituting `[CITY]`, `[STATE]`, etc.)
- Queries run in classes: 1 (city), 2 (state), 3 (operators), 4 (nearby cities, optional)
- Concurrency: 3 (DataForSEO rate-limit safe)
- Max 30 results per query (per SERP concurrency)
- Extracts: URL, title, domain, rank, snippet

#### **Stage 2: URL Normalization & Deduplication**
```
Input:  ~1,000 SERP results
Output: ~200–400 deduplicated Candidate objects
```
- **URL normalization:** ([lib/urlNormalize.ts](lib/urlNormalize.ts))
  - Strips protocol, `www.`, trailing slashes, fragments
  - Removes tracking params (utm_*, fbclid, gclid, etc.)
  - Sorts query params for consistent keys
  - Returns: `{ key (cache/dedup), fetchUrl (still-valid) }`
- **Domain dedup:** Per-domain, picks best result (prefers `/sponsor*` URLs, then lowest rank)
- **Result:** Candidate list with normalized keys

#### **Stage 3: Pre-Filter (Hard Rejects)**
```
Input:  ~200 candidates
Output: ~100–150 clean candidates to send to Ahrefs
```
**What gets rejected (before any paid API):**
- Non-HTTPS URLs
- Social platforms (Reddit, Facebook, Instagram, LinkedIn, TikTok, X, YouTube, Pinterest)
- Travel/review sites (TripAdvisor, Yelp)
- Blog platforms (Medium, Substack)
- Job boards (Indeed, ZipRecruiter, Glassdoor, etc.)
- Coupon/discount aggregators (Groupon, RetailMeNot, Honey)
- Paths like `/blog/`, `/news/`, `/careers/`, `/forum/`, `/reviews/`, `/events/` (without sponsorship signal)
- Titles: "job", "visa sponsorship", "how to get sponsors", "travel guide", etc.
- **BUT:** PDFs with `sponsorship-packet` in URL/title pass through

**Rejection categories** (tracked for reporting):
- `Blog/article result`, `Travel/review result`, `Job/visa sponsorship result`, `Forum/social result`, `Generic event/ticket result`, `Current sponsors only`, etc.

#### **Stage 4: Ahrefs DR Gate**
```
Input:  ~150 clean candidates
Output: ~80 with DR ≥ 25, ~30 with unknown DR, ~40 below threshold
```
- Fetches metrics for all unique domains (batched, concurrency=2, retry on 429)
- Metrics extracted: DR (Domain Rating), organic traffic, referring domains
- **Decision:**
  - `dr >= 25` → proceed to Firecrawl
  - `dr < 25` → rejected (reason: "DR below threshold")
  - `dr === null` → marked for review (not scraped, but noted in inventory for manual check)

#### **Stage 5: Per-Run Firecrawl Cap**
```
Input:  ~80 qualified candidates
Output: ~50 to scrape, ~30 marked "skipped" (review)
```
- Sorts by DR (descending)
- Applies per-run cap (default 50, env: `FIRECRAWL_MAX_URLS_PER_RUN`)
- URLs beyond cap → approved status set to "review" with reason "cap reached"

#### **Stage 6: Cache Lookup**
```
Input:  ~50 URLs to scrape
Output: ~15 cache hits, ~35 to scrape fresh
```
- Queries `crawl_cache` table by normalized URL
- **Hit criteria:** (now - fetched_at) < TTL
  - Success: 60 days (env: `CRAWL_CACHE_TTL_DAYS`, default 60)
  - Failure: 1 day (retries transient 404s, timeouts)
- Cache miss → fetch fresh from Firecrawl

#### **Stage 7: Firecrawl Scrape**
```
Input:  ~35 URLs
Output: ~25 successful, ~10 failed or timeout
Status: Markdown + page title + final URL
```
- **Concurrency:** 2 (free plan limit)
- **Timeout:** 30s per request
- **Retries:** 1 (backoff 2–5s)
- **Errors handled gracefully:** Failed pages go to "review" (not deleted)
- **Cache:** Successful + failed results written back to DB (non-fatal if write fails)

#### **Stage 8: Strict Content Analysis → Decision**
```
Input:  ~25 scraped pages + metrics + SERP data
Output: ~8 approved, ~12 review, ~5 rejected opportunities
```
- **Keyword matching** ([lib/pageAnalysis.ts](lib/pageAnalysis.ts)):
  - Sponsorship intent terms (e.g., "become a sponsor", "sponsorship opportunity")
  - Backlink evidence terms (e.g., "website link", "linked logo", "sponsor listing")
  - Pricing terms (e.g., "sponsor level", "package", "fee", price regex)
  - Price detection (regex: `$250`, `250 dollars`, `$250-$500`)

- **Page purpose classification** (only 4 are approvable):
  - ✅ `SponsorshipOpportunityPage` — "become a sponsor", "sponsor our event", etc.
  - ✅ `SponsorPacketOrForm` — PDFs, forms, registration pages
  - ✅ `DonationOrPartnerPage` — "become a partner", "donate"
  - ✅ `VendorOrExhibitorOpportunityPage` — booth fees, exhibitor opportunities
  - ❌ Everything else rejected (blogs, news, forums, job postings, etc.)

- **Strict decision engine** (`decideStatus()`):
  1. DR available? (if not → "review")
  2. DR >= 25? (if not → "rejected", reason "DR below threshold")
  3. Firecrawl status ok? (failed → "review", skipped → "review")
  4. Content length > 200 chars? (if not → "review")
  5. Page purpose approvable? (if not → "rejected" with category)
  6. Budget check: lowest price ≤ budget? (if not → "rejected")
  7. Backlink evidence present? (if not → "review")
  8. Locally relevant? (High/Medium required for approval; Unknown → "review")
  9. **If all pass:** "approved"
  10. **Sensitive category detected?** (religious, political, Pride, advocacy → "review" even if all checks pass)

- **Output:** Each `Opportunity` includes:
  - Basic fields (domain, city, state, URL, etc.)
  - Ahrefs metrics (DR, traffic, refs)
  - Classified decision + reason
  - `_analysis` object (not exported to CSV):
    - Page purpose + score cap
    - Matched terms (sponsorship, backlink, pricing)
    - Detected prices + within-budget bool
    - Approval reason + rejection category

---

## 3. Data Flow Through the Pipeline

### Input → Output Transformation

```
PHASE 1: User Submission (Frontend)
┌─────────────────────────────────────────────────────────────────┐
│ Client inputs:                                                  │
│  • client_primary_city (required)                              │
│  • client_state (required)                                     │
│  • maximum_approved_budget (required)                          │
│  • state_abbrev, county, metro, service_area_cities (optional)│
│  • budget_exceptions_allowed (required)                        │
│  • (deprecated: client_business_name, niche, landing_page)    │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 2: Validation ([lib/queryBank.ts](lib/queryBank.ts))
┌─────────────────────────────────────────────────────────────────┐
│ validateInputs() checks for missing required fields              │
│ If missing: return { status: "Missing Required Inputs", ... }  │
│ If valid: load query bank, render queries                      │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 3: SERP Search → Candidate Pool
┌─────────────────────────────────────────────────────────────────┐
│ ~1,000–3,000 SerpResult objects                                 │
│  {title, url, root_domain, rank, snippet, search_query_used}   │
│  + target_city, target_state                                   │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 4: Dedup + Pre-Filter
┌─────────────────────────────────────────────────────────────────┐
│ ~200–400 Candidate objects                                      │
│  {serp, key (normalized), fetchUrl}                            │
│  Hard rejects logged (blogs, jobs, social, travel, etc.)       │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 5: Ahrefs Enrichment
┌─────────────────────────────────────────────────────────────────┐
│ Candidates + AhrefsMetrics per domain:                          │
│  {dr, organic_traffic, referring_domains, error}               │
│ DR gate: >= 25 pass, < 25 rejected, null → review              │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 6: Firecrawl Scrape + Cache
┌─────────────────────────────────────────────────────────────────┐
│ ScrapeOutcome per URL:                                          │
│  {candidate, scraped, fromCache, text, title, finalUrl, error} │
│ Cached in crawl_cache (dedup key + TTL)                        │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 7: Strict Analysis
┌─────────────────────────────────────────────────────────────────┐
│ ContentAnalysis: {sponsorshipTerms[], backlinkTerms[],         │
│   pricingTerms[], prices[], lowestPrice}                        │
│ StrictDecision: {approvalStatus, approvalReason,               │
│   withinBudget, rejectionCategory}                             │
└─────────────────────────────────────────────────────────────────┘
                    ↓
PHASE 8: Opportunity Build
┌─────────────────────────────────────────────────────────────────┐
│ Opportunity[] with all fields + _analysis (internal)            │
│ + SponsorshipCrawlResult shape-shift (SOP compatibility)       │
└─────────────────────────────────────────────────────────────────┘
                    ↓
OUTPUT: RunResult
┌─────────────────────────────────────────────────────────────────┐
│ {                                                               │
│   summary: {                                                    │
│     client: string,                                            │
│     total_candidates: number,                                  │
│     status: "complete"                                         │
│   },                                                            │
│   opportunities: Opportunity[],                                │
│   stats: PipelineStats {                                       │
│     serp_results, after_dedup, non_https, prefilter_rejected,  │
│     dr_passed, dr_rejected, dr_unavailable,                    │
│     firecrawl_attempted, firecrawl_cached, firecrawl_succeeded, │
│     firecrawl_failed, over_scrape_cap,                         │
│     approved, needs_review, rejected                           │
│   }                                                             │
│ }                                                               │
└─────────────────────────────────────────────────────────────────┘
```

### Example Stats Output

```json
{
  "serp_results": 1247,
  "after_dedup": 346,
  "non_https": 18,
  "prefilter_rejected": 167,
  "dr_passed": 93,
  "dr_rejected": 68,
  "dr_unavailable": 12,
  "firecrawl_attempted": 50,
  "firecrawl_cached": 15,
  "firecrawl_succeeded": 32,
  "firecrawl_failed": 3,
  "over_scrape_cap": 43,
  "approved": 12,
  "needs_review": 28,
  "rejected": 10
}
```

---

## 4. External API Integrations

### 4.1 DataForSEO (SERP Aggregator)

**Endpoint:** `https://api.dataforseo.com/v3/serp/google/organic/live/advanced`

**Auth:** Basic Auth (DATAFORSEO_LOGIN:DATAFORSEO_PASSWORD)

**Request Payload:**
```json
[{
  "keyword": "sponsor local events Denver Colorado",
  "location_code": 2840,
  "language_code": "en",
  "depth": 30
}]
```

**Response:** Task-based (async-style). Returns organic results with rank, title, description, domain.

**Concurrency:** 3 queries in parallel (rate-limit safe)

**Caller:** [lib/dataforseo.ts](lib/dataforseo.ts) → `serpQuery()`

**Fallback:** If a query fails, it logs the error and continues with remaining queries (does not crash).

---

### 4.2 Ahrefs (Domain Authority Metrics)

**Endpoints:**
- `/v3/site-explorer/domain-rating` → DR (0–100 scale)
- `/v3/site-explorer/metrics` → organic traffic, referring domains

**Auth:** Bearer token (AHREFS_API_TOKEN)

**Rate Limiting:** Aggressive 429 on high concurrency; retry once after 2.5s backoff.

**Concurrency:** 2 (must keep low per Ahrefs docs)

**Caller:** [lib/ahrefs.ts](lib/ahrefs.ts) → `domainMetricsBatch()`

**Data Extracted:**
```typescript
interface AhrefsMetrics {
  dr: number | null,          // 0–100, null if unavailable
  organic_traffic: number | null,    // monthly estimate
  referring_domains: number | null,  // count
  error?: string              // API error message if present
}
```

**Scoring Function** ([lib/decision.ts](lib/decision.ts)):
- DR >= 40 → 20 pts (high trust)
- DR 15–40 → 12 pts (moderate)
- DR > 0 → 6 pts (low)
- Traffic >= 1,000/mo → +3 pts (optional/secondary)

---

### 4.3 Firecrawl (Page Scraping)

**Endpoint:** `https://api.firecrawl.dev/v1/scrape`

**Auth:** Bearer token (FIRECRAWL_API_KEY)

**Free Plan Limits:**
- 1,000 pages/month
- 2 concurrent requests
- Timeout: 30s per page

**Request Payload:**
```json
{
  "url": "https://example.com/sponsor",
  "formats": ["markdown"],
  "onlyMainContent": true,
  "timeout": 30000
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "markdown": "...",
    "metadata": {
      "title": "Sponsorship Opportunities",
      "url": "https://example.com/sponsor",
      "sourceURL": "https://example.com/sponsor"
    }
  }
}
```

**Caller:** [lib/firecrawl.ts](lib/firecrawl.ts) → `scrapeUrl()`

**Error Handling:**
- 402 (out of credits) → non-cacheable, breaks loop
- 429 (rate limit) → cacheable, retries after 5s
- Network timeout → cacheable, retries once
- Markdown content too short (<200 chars) → routed to "review"

**Cache Strategy:**
- **Key:** Normalized URL (host + path + sorted query params)
- **Success TTL:** 60 days (env: `CRAWL_CACHE_TTL_DAYS`)
- **Failure TTL:** 1 day (to allow transient errors to retry)
- **Stored in:** `crawl_cache` table (indexed on normalized_url + fetched_at)

---

## 5. Database Schema & Structure

**Database:** Neon Postgres (serverless, Vercel integration)

**Init:** Lazy-loaded in [lib/db.ts](lib/db.ts); schema applied by migration script.

### Table: `opportunities`

Core inventory of all discovered opportunities.

```sql
CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  sponsorship_url TEXT NOT NULL,
  sponsor_page_url TEXT NOT NULL,
  opportunity_name TEXT,
  opportunity_type TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  local_relevance_rating TEXT,
  local_relevance_notes TEXT,
  current_sponsors_displayed TEXT,
  current_sponsors_linked TEXT,
  link_opportunity_status TEXT,
  link_evidence TEXT,
  payment_amount TEXT,
  payment_type TEXT,
  cheapest_tier_with_link TEXT,
  tier_name TEXT,
  submission_method TEXT,
  submission_url TEXT,
  contact_email TEXT,
  contact_person TEXT,
  dr DOUBLE PRECISION,
  da DOUBLE PRECISION,
  organic_traffic DOUBLE PRECISION,
  https TEXT,
  freshness_notes TEXT,
  notes TEXT,
  decision TEXT,
  human_review_trigger TEXT,
  score DOUBLE PRECISION,
  search_query_used TEXT,
  client_origin TEXT,
  run_id TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_used_by_client TEXT,
  last_used_at BIGINT,
  
  -- Added fields (via idempotent ALTERs)
  location TEXT,
  normalized_url TEXT,
  review_reasons TEXT,
  sensitive_category TEXT,
  duplicate_of TEXT,
  last_checked_at BIGINT,
  last_refreshed_at BIGINT,
  
  UNIQUE(domain, sponsorship_url)
);

-- Indexes (for filtering, sorting)
CREATE INDEX idx_opportunities_city ON opportunities(city);
CREATE INDEX idx_opportunities_state ON opportunities(state);
CREATE INDEX idx_opportunities_decision ON opportunities(decision);
CREATE INDEX idx_opportunities_created ON opportunities(created_at);
CREATE INDEX idx_opportunities_location ON opportunities(location);
CREATE INDEX idx_opportunities_domain ON opportunities(domain);
```

**Key Constraints:**
- Deduplication: UNIQUE(domain, sponsorship_url) prevents exact duplicates
- Multiple columns are nullable (to handle parse failures gracefully)
- Timestamps: BIGINT (seconds since epoch, for easier date math)

**Decision Values:**
- `"Approve"` — auto-approved, ready to purchase
- `"Needs Human Review"` — requires manual verification
- `"Reject"` — does not meet criteria

---

### Table: `research_runs`

Audit trail of research executions (client, location, stats, query count).

```sql
CREATE TABLE research_runs (
  id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  target_city TEXT NOT NULL,
  target_state TEXT NOT NULL,
  run_date BIGINT NOT NULL,
  total_candidates INTEGER,
  approved_count INTEGER,
  review_count INTEGER,
  rejected_count INTEGER,
  queries_used TEXT,
  created_at BIGINT NOT NULL
);

CREATE INDEX idx_runs_client ON research_runs(client_name);
CREATE INDEX idx_runs_city_state ON research_runs(target_city, target_state);
CREATE INDEX idx_runs_created ON research_runs(created_at);
```

---

### Table: `crawl_cache`

Firecrawl scrape results, deduped by normalized URL + TTL.

```sql
CREATE TABLE crawl_cache (
  normalized_url TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  final_url TEXT,
  page_title TEXT,
  scraped_text TEXT,
  status TEXT NOT NULL,      -- "success" | "failed"
  error TEXT,
  fetched_at BIGINT NOT NULL
);

CREATE INDEX idx_crawl_cache_fetched ON crawl_cache(fetched_at);
```

**Purpose:** Avoid re-scraping the same page within a TTL window (saves free-plan credits).

**Cleanup:** No automatic purge (assumes external maintenance or slow accumulation).

---

## 6. Decision Logic & Strictness

### The "Strict" Approval Philosophy

**Core Rule:** *Never approve based on title/snippet/URL alone.* Approval requires:

1. ✅ DR >= 25 (domain authority validated by Ahrefs)
2. ✅ Page successfully scraped by Firecrawl (or cached within TTL)
3. ✅ Page content **actually offers a sponsorship opportunity** (classified by `PagePurpose`)
4. ✅ **Explicit backlink/website link evidence** in scraped content (not inferred)
5. ✅ **Price detected and within budget** (or unknown → review, never approve)
6. ✅ **Locally relevant** (city/metro/state in URL or title)
7. ❌ **Not a sensitive category** (religious, political, Pride, advocacy → review even if all above pass)

**Missing Core Data → Always Review, Never Approve**
- DR unavailable? → review
- Firecrawl failed/timed out? → review
- Content too short? → review
- Price unknown but page is otherwise good? → review
- Local relevance unclear? → review

### Page Purpose Classification

**Approvable** (only these 4):
- `SponsorshipOpportunityPage` — Contains "become a sponsor", "sponsor our event", "sponsorship opportunity"
- `SponsorPacketOrForm` — PDF or form for submitting sponsorship requests
- `DonationOrPartnerPage` — "become a partner", "donate to"
- `VendorOrExhibitorOpportunityPage` — Vendor/exhibitor booth opportunities

**Non-Approvable** (hard rejected regardless of DR):
- `BlogArticle` — Article discussing sponsorships (talks about, doesn't offer)
- `NewsArticle` — News content
- `TravelOrReviewPage` — Travel/tourism content
- `JobPosting` — Job listings, visa sponsorship
- `ForumThread` — Forum discussion
- `SocialMediaPage` — Twitter, Instagram, Reddit, etc.
- `GenericEventPage` — Event page with no sponsorship offer signal
- `TicketOrRegistrationPage` — Ticket sales, event registration
- `DirectoryListing` — Business directory
- `CurrentSponsorsOnlyPage` — "Our sponsors" list with no "become a sponsor" path
- `Unknown` — Insufficient evidence

**Score Caps by Purpose** ([lib/pageAnalysis.ts](lib/pageAnalysis.ts)):
- Approvable purposes: 100 (no cap)
- Unknown: 40 (soft evidence)
- CurrentSponsorsOnly: 35 (listing only)
- GenericEventPage: 30 (possible opportunity)
- BlogArticle, NewsArticle: 20
- TravelOrReviewPage, ForumThread, SocialMediaPage, etc.: 10
- JobPosting: 0 (auto-reject)

### Keyword Matching

**Sponsorship Intent Terms** (e.g., "sponsor", "become a sponsor", "sponsorship opportunity", "corporate sponsor", "vendor", "exhibitor", "donor"):
- If found in scraped content, signals real opportunity intent

**Backlink Evidence Terms** (e.g., "website link", "linked logo", "sponsor listing", "online recognition", "link to your website"):
- **Critical for approval:** If found, "link opportunity status" = "Confirmed"
- If not found but sponsorship intent present, status = "Unclear" → review
- If neither found, status = "No Link Opportunity" → review/reject

**Pricing Terms** (e.g., "$", "fee", "package", "sponsor level", "bronze/silver/gold"):
- Extracted for scoring; lower tier found = likely lowest price

**Price Detection** (regex patterns):
```regex
$250 / $1,234.56           // literal $ amount
250 dollars / 1,234 dollars // written-out dollar
$250-$500 / $250 to $500   // price range (both endpoints extracted)
```

---

### Decision Tree (Pseudocode)

```javascript
function decideStatus(input) {
  // 1. DR available?
  if (input.dr === null) 
    return { status: "review", reason: "Ahrefs DR unavailable" };
  
  // 2. DR >= threshold (25)?
  if (input.dr < DR_MINIMUM) 
    return { status: "rejected", reason: "DR below threshold" };
  
  // 3. Firecrawl result ok?
  if (input.firecrawlStatus === "failed") 
    return { status: "review", reason: "Page could not be scraped" };
  if (input.firecrawlStatus === "skipped") 
    return { status: "review", reason: "Firecrawl cap reached" };
  
  // 4. Content length adequate?
  if (input.contentLength < MIN_CONTENT_LENGTH)  // 200 chars
    return { status: "review", reason: "Scraped content too short" };
  
  // 5. Page purpose approvable?
  if (!APPROVABLE_PAGE_PURPOSES.has(input.pagePurpose)) 
    return { status: "rejected", reason: PURPOSE_REJECTION[pagePurpose] };
  
  // 6. Price within budget?
  const withinBudget = (input.lowestPrice === null) 
    ? null 
    : (input.lowestPrice <= input.budget);
  if (withinBudget === false) 
    return { status: "rejected", reason: "All prices exceed budget" };
  
  // 7. Has link evidence?
  const hasLinkEvidence = input.backlinkTerms.length > 0;
  
  // 8. Locally relevant?
  const locallyRelevant = (input.localRelevance === "High" 
    || input.localRelevance === "Medium");
  
  // Auto-approve ONLY if: link evidence + budget ok + locally relevant
  if (hasLinkEvidence && withinBudget === true && locallyRelevant) {
    let status = "approved";
    let reason = `Approved: ${pagePurpose}, DR ${dr}, link evidence, in budget`;
    
    // 9. Sensitive category check (override if detected)
    if (detectSensitiveCategory()) 
      return { status: "review", reason: `${reason} [BUT sensitive category]` };
    
    return { status, reason };
  }
  
  // Otherwise → review (something is uncertain)
  return { status: "review", reason: "..." };
}
```

---

## 7. Integration Points & Feature Status

### ✅ Fully Implemented

| Feature | Status | Location |
|---------|--------|----------|
| DataForSEO SERP queries | ✅ | [lib/dataforseo.ts](lib/dataforseo.ts) |
| Ahrefs metrics fetch | ✅ | [lib/ahrefs.ts](lib/ahrefs.ts) |
| Firecrawl scraping | ✅ | [lib/firecrawl.ts](lib/firecrawl.ts) |
| URL normalization + dedup | ✅ | [lib/urlNormalize.ts](lib/urlNormalize.ts) |
| Pre-filter (hard rejects) | ✅ | [lib/pageAnalysis.ts](lib/pageAnalysis.ts) → `preFilterSerpResult()` |
| Page purpose classification | ✅ | [lib/pageAnalysis.ts](lib/pageAnalysis.ts) → `classifyPagePurpose()` |
| Strict content analysis | ✅ | [lib/pageAnalysis.ts](lib/pageAnalysis.ts) → `analyzeContent()`, `decideStatus()` |
| Price detection (regex) | ✅ | [lib/pageAnalysis.ts](lib/pageAnalysis.ts) → `detectPrices()` |
| Local relevance scoring | ✅ | [lib/decision.ts](lib/decision.ts) → `classifyLocalRelevance()` |
| Sensitive category detection | ✅ | [lib/decision.ts](lib/decision.ts) → `detectSensitiveCategory()` |
| Crawl cache (TTL-based) | ✅ | [lib/db.ts](lib/db.ts), `crawl_cache` table |
| Research run auditing | ✅ | [lib/db.ts](lib/db.ts), `research_runs` table |
| Opportunity inventory storage | ✅ | [lib/db.ts](lib/db.ts), `opportunities` table |
| CSV export | ✅ | [lib/csv.ts](lib/csv.ts) → `toCsv()` |
| Query bank rendering | ✅ | [lib/queryBank.ts](lib/queryBank.ts) → `renderQueries()` |
| Query preview endpoint | ✅ | [app/api/queries/route.ts](app/api/queries/route.ts) |
| Search inventory endpoint | ✅ | [app/api/opportunities/search/route.ts](app/api/opportunities/search/route.ts) |
| Status check endpoint | ✅ | [app/api/status/route.ts](app/api/status/route.ts) |
| Frontend dashboard | ✅ | [app/page.tsx](app/page.tsx) |
| Result filtering + sorting | ✅ | [app/page.tsx](app/page.tsx), also server-side in search route |
| Inline row editing | ✅ | [app/page.tsx](app/page.tsx) |
| Inventory save | ✅ | [app/api/opportunities/save/route.ts](app/api/opportunities/save/route.ts) |

### 🔄 Partial/In-Progress

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-client auth | 🔄 | Not yet implemented; all data mixed in shared inventory |
| Outreach tracking | 🔄 | No order placement, followup, or email integration |
| Scheduled re-runs | 🔄 | Manual trigger only; no cron/scheduler |
| Duplicate detection | 🔄 | UNIQUE constraint on (domain, url), but similar orgs not merged |

### ❌ Out of Scope (v0.1)

- Multi-user auth / role-based access
- Outreach execution (email, payment submission)
- Scheduled automation (e.g., weekly re-runs)
- Multi-language support
- Complex reporting (charts, trends)
- Lead scoring based on client business type

---

## 8. Configuration & Environment Variables

### Required Environment Variables

```bash
# DataForSEO
DATAFORSEO_LOGIN=<username>
DATAFORSEO_PASSWORD=<password>

# Ahrefs
AHREFS_API_TOKEN=<bearer-token>

# Firecrawl
FIRECRAWL_API_KEY=<api-key>

# Database (Neon Postgres)
DATABASE_URL=postgresql://user:pass@host/dbname?sslmode=require
```

**Setup for Development:**
1. Create `.env.local` in project root (gitignored)
2. Copy values from each API provider
3. Run: `npm run migrate` to initialize database schema

**Setup for Vercel Deployment:**
1. Go to Vercel Project Settings → Environment Variables
2. Add all env vars (same names)
3. On deployment, `.env` auto-pulled from Vercel settings

### Optional Configuration (Defaults)

```bash
# Firecrawl concurrency (free plan: 2)
FIRECRAWL_MAX_URLS_PER_RUN=50

# Cache TTL for successful crawls (days)
CRAWL_CACHE_TTL_DAYS=60
```

**Tuning Defaults** (in [lib/sponsorshipConfig.ts](lib/sponsorshipConfig.ts)):
- `DR_MINIMUM = 25`
- `DEFAULT_CLIENT_BUDGET = 300`
- `MIN_CONTENT_LENGTH = 200`
- `FIRECRAWL_CONCURRENCY = 2`

---

## 9. Pipeline Stats & Reporting

The `PipelineStats` object tracks each stage for reporting:

```typescript
interface PipelineStats {
  serp_results: number;              // Total SERP hits
  after_dedup: number;               // After domain/URL dedup
  non_https: number;                 // HTTPS filter rejections
  prefilter_rejected: number;        // Hard-reject (blogs, jobs, etc.)
  dr_passed: number;                 // DR >= 25
  dr_rejected: number;               // DR < 25
  dr_unavailable: number;            // DR null (not scraped)
  firecrawl_attempted: number;       // URLs sent to Firecrawl
  firecrawl_cached: number;          // Cache hits
  firecrawl_succeeded: number;       // Successful scrapes
  firecrawl_failed: number;          // Scrape failures
  over_scrape_cap: number;           // Qualified but not scraped (cap)
  approved: number;                  // Auto-approved
  needs_review: number;              // Human review required
  rejected: number;                  // Auto-rejected
}
```

**Example Dashboard Insight:**
- SERP returned 1,247 URLs
- After dedup: 346 candidates
- Pre-filter rejected 167 (blogs, jobs, travel, etc.)
- Ahrefs gate: 93 passed (DR ≥ 25), 68 rejected (low DR), 12 unknown (not scraped)
- Firecrawl: 32 succeeded, 3 failed, 15 from cache, 43 skipped (cap reached)
- Final: 12 approved, 28 review, 10 rejected

---

## 10. Deployment & Scalability

### Deployment Target: Vercel

- **Framework:** Next.js 16 with App Router
- **Database:** Neon Postgres (serverless, auto-scales)
- **Function Timeout:** 300s (5 min, set in `app/api/run/route.ts`)
- **Build:** Turbopack (via Next.js 16 default)

### Concurrency & Rate Limiting

| Service | Limit | Reason |
|---------|-------|--------|
| DataForSEO SERP | 3 | Rate-limit safe per docs |
| Ahrefs API | 2 | Aggressive 429 on higher concurrency |
| Firecrawl | 2 | Free plan limit |

**Free Plan Constraints:**
- Firecrawl: 1,000 pages/month (single-user dev likely OK; multi-client needs upgrade)
- Ahrefs: Standard rate limits (retried once on 429)
- DataForSEO: Depends on account tier

### Known Scalability Considerations

1. **Database:** Neon scales to modest usage; no sharding for multi-client (future work)
2. **API Concurrency:** Hard-limited by free plan; can't parallelize more runs
3. **Firecrawl Budget:** 50 URLs per run × 20 runs/month = 1,000 pages (at limit)
4. **Search Index:** Single `opportunities` table; no partitioning (OK for ~10K records)

---

## 11. Code Quality & Testing

### Test Suite

**Command:** `npm test`

**Script:** [scripts/validateAnalysis.ts](scripts/validateAnalysis.ts)

**Purpose:** Rule-based validation cases for the `decideStatus()` function (strict analysis logic).

**Example Tests:**
- High DR + link evidence + budget ok = APPROVE
- Low DR (< 25) = REJECT
- Page purpose = BlogArticle = REJECT
- Missing backlink evidence = REVIEW
- Price > budget = REJECT
- Sensitive category (religious, political, Pride) = REVIEW (even if all pass)

### Linting

**Command:** `npm run lint`

**Config:** ESLint 9 + `eslint-config-next`

**Rules:** Standard Next.js best practices (no console logs in prod, etc.)

---

## 12. Recent Additions & Key Features

### Query Bank System ([skills/sponsorship/query-bank.csv](skills/sponsorship/query-bank.csv))

The app uses a **query bank** (CSV) to render search queries dynamically:

| Class | Purpose | Example |
|-------|---------|---------|
| 1 | Core city-based | `[CITY] [STATE] sponsor local events` |
| 2 | Core state-based | `[STATE] nonprofit event sponsorship` |
| 3 | High-value operators | `site:*.pdf [CITY] sponsorship` |
| 4 | Nearby city expansion | `[NEARBY CITY] [STATE] event sponsor opportunities` |

**Substitution Variables:**
- `[CITY]` — client_primary_city
- `[STATE]` — client_state (full name)
- `[STATE ABBREV]` — state abbreviation (optional)
- `[COUNTY]` — county name (optional)
- `[METRO]` — metro area (optional)
- `[NEARBY CITY]` — service_area_cities elements (optional, expands class 4)

### Sensitivity Detection

Even when all strict criteria pass, certain categories are routed to "review":
- Religious organization (church, mosque, synagogue, ministry, parish, diocese)
- Political organization (campaign, PAC, candidate, election)
- Pride/LGBTQ-related event (Pride, LGBTQ+, LGBT)
- Advocacy-focused sponsorship (activism, advocacy)

**Rationale:** Client may wish to approve or decline these manually before committing to purchase.

### Cache Strategy & Deduplication

- **Normalized URL Key:** `host (no www) + path (no trailing /) + sorted query params`
- **Success TTL:** 60 days (by default, tunable)
- **Failure TTL:** 1 day (allows transient errors to retry next day)
- **Benefits:**
  - Same page discovered in different queries → scrape once
  - Same page across multiple client runs → shared cache
  - Free-plan Firecrawl budget preserved

---

## 13. Error Handling & Graceful Degradation

### Pipeline Resilience

1. **DataForSEO query failure:** Log error, continue to next query (doesn't crash entire run)
2. **Ahrefs timeout:** Single retry after backoff; if still fails, mark as "unknown DR" → route to review
3. **Firecrawl out of credits (402):** Non-cacheable, breaks further scrape attempts; remaining URLs routed to "review"
4. **Firecrawl timeout (30s):** Cacheable, retries once; if still fails, routes to "review"
5. **Database unavailable:** Cache writes fail silently (non-fatal); all URLs still processed
6. **Missing environment variable:** Returns 500 error with clear message (checklist in `/api/status`)

### User-Facing Error Handling

- **Form validation:** Lists all missing required fields before submission
- **API errors:** 422 for validation, 500 for runtime, with descriptive messages
- **Network failures:** Logged to console; users see error notification in UI

---

## 14. Future Roadmap & Extensibility

### Possible Enhancements

1. **Multi-client isolation:** Add `client_id` field; scope all queries to client
2. **Outreach workflow:** Track email/phone contacts; integrate CRM/email API
3. **Automated re-runs:** Cron job to re-scrape stale results (refresh DR, detect price changes)
4. **Advanced filtering:** Rich UI for segment clients by ownership (veteran-owned, minority-owned, etc.)
5. **Competitor analysis:** Flag opportunities already secured by known competitors
6. **Compliance checks:** Validate opportunities against client's exclusion list (avoid controversial categories)

### Architectural Extensibility

- **New keyword groups:** Edit [lib/sponsorshipConfig.ts](lib/sponsorshipConfig.ts) to add terms
- **New rejection categories:** Add to `RejectionCategory` type in [lib/types.ts](lib/types.ts)
- **New page purposes:** Extend `PagePurpose` enum; update classification in `classifyPagePurpose()`
- **Alternate data sources:** Replace DataForSEO with Google API, Bing, etc. (swap [lib/dataforseo.ts](lib/dataforseo.ts))
- **Custom scoring:** Modify `siteTrustScore()`, `trafficScore()`, `relevanceScore()` in [lib/decision.ts](lib/decision.ts)

---

## Summary

The sponsorship backlink research app is a **strict, rule-driven system** that combines SERP discovery, domain authority vetting, intelligent page scraping, and deterministic keyword/price matching to identify real sponsorship opportunities. Its key strength is the **8-stage pipeline** that progressively filters candidates (cost-conscious order) while maintaining high data quality through:

- Pre-filtering before any paid API (saves DataForSEO/Ahrefs budget)
- Ahrefs DR gate before Firecrawl (saves Firecrawl credits)
- Strict page-purpose classification (rejects non-opportunity pages outright)
- Explicit backlink evidence requirement (not inferred from title/snippet)
- Conservative approval logic (missing data goes to review, never auto-approved)
- Sensitivity detection (political, religious, advocacy → human review)

**Current State:** Production-ready for single-client research runs. Multi-client scaling and outreach workflow are future enhancements.

**Tech Stack:** Next.js 16, TypeScript, Neon Postgres, Tailwind CSS v4.

**Deploy Target:** Vercel (with Neon database integration).
