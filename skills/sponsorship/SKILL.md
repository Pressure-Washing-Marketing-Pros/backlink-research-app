# Sponsorship Backlink Research

Discover, qualify, and document local sponsorship opportunities where a client's business name, logo, and website can appear on a public page of a local organization, event, school, club, nonprofit, or community site — resulting in a real, public backlink.

This is a research and qualification system only — it does not handle outreach, payment, or submission execution.

## Before You Start

Read the reference files to understand the full rules:

- `skills/sponsorship/SOP.md` — The complete SOP governing discovery, qualification, scoring, and decision logic. This is your primary source of truth.
- `skills/sponsorship/query-bank.csv` — The exact search queries to use, organized by class and priority.

Read both before beginning any research run.

## Inputs Required

### Required (must have all before starting)

| Input | Notes |
| --- | --- |
| `client_business_name` | Full business name |
| `client_website_url` | Main website |
| `client_primary_city` | Target city |
| `client_state` | Full state name |
| `client_niche` | e.g., pressure washing, exterior cleaning |
| `preferred_landing_page_url` | Page to link to |
| `maximum_approved_budget` | Dollar cap for sponsorships |
| `budget_exceptions_allowed` | Yes/No |

### Optional (use when available)

| Input | Notes |
| --- | --- |
| `service_area_cities` | Expands geographic search |
| `nearby_cities_allowed` | Additional nearby markets |
| `gbp_city` | Google Business Profile city |
| `ownership_tags` | veteran-owned, family-owned, women-owned, minority-owned, nonprofit-friendly |
| `client_outreach_email` | For contact recommendations |

**Input validation rule:** If any required field is missing, stop and list the missing fields. Do not begin research until all required inputs are present.

## Workflow

### Phase 1: Execute Query Bank

Use the query bank in `skills/sponsorship/query-bank.csv`. Replace `[CITY]`, `[STATE]`, `[STATE ABBREV]`, `[COUNTY]`, `[METRO]`, and `[NEARBY CITY]` with actual client data.

**Query execution order:**

1. Core city-based queries (Class 1) — always run first
2. Core state-based queries (Class 2) — run after city, especially when city results are thin
3. High-value operator queries (Class 3) — best support queries for nonprofits, sponsor pages, PDFs
4. Nearby relevance queries (Class 4) — only if client serves adjacent areas

**Search rules:**

- Review first 3 pages of results per query
- Max 30 candidates per query before deduplication
- Record which query surfaced each candidate
- Do not invent, expand, or rewrite queries — use them exactly as supplied

**Query bank rule:** The agent must not invent new queries, expand the bank, optimize queries, or broaden search intent beyond sponsorship research.

### Phase 2: Collect and Deduplicate Candidates

For each search result, store: title, URL, root domain, search query used, target city, target state.

Deduplicate by:

- Root domain
- Same sponsorship URL
- Same organization/event name

If multiple URLs exist on the same domain, keep the one most likely to be sponsorship-related (otherwise the org homepage).

### Phase 3: Classify and Crawl Each Candidate

Assign one Opportunity Type:

- Nonprofit
- Event
- Race / Marathon
- School / PTA / Booster Club
- Chamber / Association
- Community Group
- Foundation
- Arts / Museum / Historic Org
- Club / Recreation
- Animal Rescue
- Unknown

For each candidate domain, inspect up to:

- 10 relevant HTML pages
- 3 relevant PDFs if linked

Stop crawling once you have enough evidence to classify the opportunity.

Search each site for sponsorship evidence — look for pages containing:

`sponsor`, `sponsors`, `become a sponsor`, `sponsor us`, `sponsorship`, `sponsorship package`, `sponsor opportunities`, `community partners`, `partners`, `supporters`, `annual sponsors`, `corporate sponsors`, `donor recognition`

Store: Sponsorship URL, Sponsor Page URL, linked package/PDF URL where applicable.

### Phase 4: Evaluate Each Opportunity

For every candidate that has sponsorship evidence, evaluate these dimensions. Full rules are in `skills/sponsorship/SOP.md`.

**A. Public Sponsor Visibility**

- Are sponsors displayed publicly? (logos, names, acknowledgments, partner pages) → Yes/No
- Are current sponsors linked to external websites? → Yes/No

**B. Link Opportunity Status**

- **Confirmed** — Current sponsors link to external sites, OR package explicitly states "website link" / "linked logo"
- **Probable** — Sponsors displayed publicly, package promises website recognition, but no direct link proof
- **Unclear** — Sponsors visible but no link evidence, benefits are vague
- **No Link Opportunity** — Benefits are only print/social/offline, donation only, no web attribution

**C. Pricing and Payment**

Extract: sponsorship amount, tier names, cheapest tier with link benefit, payment frequency. If pricing isn't public, set Payment Amount = Unknown, add note "Pricing unknown - contact required."

Payment Type must be exactly one of: `One-Time`, `Annual`, `Monthly`, `Recurring`, `Unknown`

**D. Submission Path**

Find the best contact method, in priority order: dedicated sponsorship form → contact email → contact person → general contact form → PDF package with instructions → phone only.

Submission Method must be one of: `Form`, `Email`, `Phone`, `PDF Package`, `Unknown`

**E. Local Relevance**

- **High** — Organization/event is in client's primary city, same metro, same county, or approved service area city
- **Medium** — Nearby approved city or clearly adjacent local service market
- **Low** — Outside target geography, regional with weak local tie, generic statewide

**F. Site Trust and Freshness**

Collect: DR, DA, estimated traffic, HTTPS status, freshness signs (recent copyright, current events, functioning navigation, current contact info). Use Ahrefs MCP tools for DR and traffic. If metrics unavailable, use "Unknown" — do not reject solely for missing metrics.

### Phase 5: Apply Decision Logic

**Approve — ALL must be true:**

- Local relevance is High or acceptable Medium
- Sponsors publicly visible OR sponsor package clearly exists
- Link opportunity is Confirmed or Probable
- Site is HTTPS
- Site appears legitimate
- Payment is One-Time, or Annual at acceptable cost with strong local value
- Submission/contact path exists

**Needs Human Review — ANY is true:**

- Price exceeds budget
- Annual/recurring but highly local
- Link opportunity is Unclear but overall value is strong
- Pricing unknown but sponsor evidence is strong
- Chamber/association that's costly or recurring
- Sponsors inconsistently linked
- Terms incomplete but promising
- Strong relevance but one critical field missing

**Reject — ANY is true:**

- Local relevance is Low
- No sponsor visibility and no sponsor package evidence
- Link opportunity is No Link Opportunity
- Only donation with no business attribution
- Only logo exposure with no web listing or link evidence
- Site is not HTTPS
- Site is broken, spammy, or abandoned
- Recurring payment with clearly poor value
- No practical contact path and no package details

### Phase 6: Score Each Opportunity

Calculate a priority score (0–100) using these weights:

| Factor | Weight | Scoring |
| --- | --- | --- |
| Local Relevance | 35 | High=35, Medium=20, Low=0 |
| Backlink Certainty | 30 | Confirmed=30, Probable=20, Unclear=8, No Link=0 |
| Price/Payment | 20 | One-Time in budget=20, Annual in budget=10, Unknown=8, Over budget=5, Monthly/poor recurring=0 |
| Site Trust/Authority | 10 | Strong=10, Legitimate but modest=6, Weak/unclear=3, Spammy=0 |
| Traffic | 5 | Meaningful=5, Low but real=3, Unknown=2, Negligible/spam=0 |

Store the score in the Notes column or as an added column.

### Phase 7: Generate Output

Render results in the app's sortable, filterable table UI, then export to CSV.

**Table UI** — Every non-rejected opportunity (Decision = Approve or Needs Human Review) shown using the exact output columns from the SOP (see `skills/sponsorship/SOP.md` Section 3 for the full column list). Default sort: score descending. The UI must support filtering by Decision so the "Approved only" view is one click away.

**Run Summary panel** — Above or alongside the table, display: client name, city/state, run date, total candidates reviewed, approved count, review count, rejected count, and the list of queries used.

**CSV export** — All non-rejected rows exported as a single CSV using the SOP Section 3 columns (with `Decision` included so the file can be filtered externally).

Save as: `[Client Name] - Sponsorship Research - [Date].csv`

## Non-Negotiable Rules

- **No non-HTTPS sites** — Auto-reject any site without HTTPS
- **No donation-only pages** — "Give now" / general donation pages without sponsor recognition are not sponsorship opportunities
- **No fabrication** — Never invent metrics, contact info, pricing, link status, or qualification. If unknown, mark as Unknown.
- **Query bank is sacred** — Do not invent, expand, optimize, or rewrite queries
- **Deduplicate by root domain** — One row per organization unless materially different programs exist
- **Every approved/review row must be complete** — All required fields filled or marked Unknown before finalizing

## Special Rules

**Chambers of Commerce:** Don't prioritize them first. Keep if highly local with sponsor/member listing that includes links. Flag for review if expensive, annual, above budget, or unclear on link inclusion. Do not reject only because expensive.

**Pricing Hidden but Strong Evidence:** If sponsor page exists, sponsors are publicly visible, linked sponsors exist or website recognition is strongly implied, and contact path exists — keep it, set Decision = Needs Human Review, note "Promising - outreach needed for pricing."

**Annual Programs:** Do not auto-approve. Annual sponsorships should usually be review-worthy, approved only when value is clearly strong and budget fits.

**Visible Sponsors but Not Linked:** Check package language, PDFs, and tier descriptions. If no evidence of website link exists, set Link Opportunity Status = Unclear or No Link Opportunity. Usually reject unless strong evidence suggests linked placement elsewhere.

## Human Review Triggers

Flag for human review when:

- Cost exceeds approved budget
- Annual or recurring payment
- Pricing unknown
- Backlink not fully confirmed
- Chamber or association opportunity
- Terms incomplete
- Public sponsor page hard to verify
- Metrics weak but relevance strong
- Highly local but commercial benefit unclear

If none apply, set Human Review Trigger = None.

## Tone and Output Style

Write for SEO specialists who understand DR, dofollow links, and sponsorship-based link building. Keep notes concise and evidence-based. Every note should answer: why is this locally relevant, what proves/suggests the backlink, what's the pricing situation, and how to contact.
