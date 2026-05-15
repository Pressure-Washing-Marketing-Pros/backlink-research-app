# SOP: AI Agent Workflow for Local Sponsorship Backlink Research

**Version:** 2.1
**Purpose:** Execution SOP for an AI agent
**Scope:** Sponsorship opportunities only
**Use Case:** Local SEO backlink research for exterior cleaning/pressure washing clients

## 1. Mission

The AI agent must identify, qualify, and document localized sponsorship opportunities that may place the client's business name, logo, and website on a public page of a local organization, event, school, club, nonprofit, or community site.

The agent must return only opportunities that are:

- geographically relevant
- legitimate and secure
- sponsorship-based, not general donations
- capable of providing or strongly implying a public website backlink
- documented in a structured table for human review

## 2. Required Inputs

### 2.1 Required Client Inputs

The agent must not start until all required inputs are present.

Required fields:

- `client_business_name`
- `client_website_url`
- `client_primary_city`
- `client_state`
- `client_niche`
- `preferred_landing_page_url`
- `maximum_approved_budget`
- `budget_exceptions_allowed` (Yes/No)
- `query_bank`

### 2.2 Optional Inputs

Use when available:

- `service_area_cities`
- `nearby_cities_allowed`
- `gbp_city`
- `ownership_tags`
  - veteran-owned
  - family-owned
  - women-owned
  - minority-owned
  - nonprofit-friendly
- `client_outreach_email`
- `query_bank_source`
- `query_bank_version`

### 2.3 Query Bank Rule

The agent must use the provided `query_bank` exactly as supplied unless explicitly instructed otherwise.

The agent must not:

- invent new queries
- expand the query bank
- optimize or rewrite queries
- broaden search intent beyond sponsorship research

The agent may:

- execute the supplied queries
- map each query to the target geography supplied in the input
- record which query produced each candidate

### 2.4 Input Validation Rule

If any required field is missing, stop and return:

- `status = Missing Required Inputs`
- list of missing fields

Do not continue research until all required inputs are present.

## 3. Final Output Required

The agent must output one row per opportunity in CSV-compatible table format using these exact columns:

- Client
- Target City
- Opportunity Name
- Domain
- Opportunity Type
- Sponsorship URL
- Sponsor Page URL
- City
- State
- Local Relevance Rating
- Local Relevance Notes
- Current Sponsors Displayed Publicly
- Current Sponsors Linked
- Link Opportunity Status
- Link Evidence
- Payment Amount
- Payment Type
- Cheapest Tier With Link
- Tier Name
- Submission Method
- Submission URL
- Contact Email
- Contact Person
- DR
- DA
- Traffic
- HTTPS
- Freshness / Site Quality Notes
- Notes
- Decision
- Human Review Trigger

**Allowed values for Decision:**

- Approve
- Reject
- Needs Human Review

**Allowed values for Link Opportunity Status:**

- Confirmed
- Probable
- Unclear
- No Link Opportunity

**Allowed values for Payment Type:**

- One-Time
- Annual
- Monthly
- Recurring
- Unknown

**Allowed values for Submission Method:**

- Form
- Email
- Phone
- PDF Package
- Unknown

**Allowed values for HTTPS:**

- Yes
- No

## 4. Research Priorities

When evaluating opportunities, apply this priority order:

1. local relevance
2. backlink opportunity certainty
3. price/payment acceptability
4. trust/authority
5. traffic

Do not reject a site only because traffic is low if:

- it is strongly local
- the sponsorship is real
- the sponsor page is public
- a backlink is confirmed or probable

## 5. Opportunity Definition

A usable opportunity is a website where a business can become a sponsor, partner, donor-recognized business, supporter, or community sponsor and appear publicly on the site with likely or confirmed website attribution.

### 5.1 Acceptable Opportunity Types

The agent may keep opportunities from:

- nonprofits
- local events
- races / marathons
- school / PTA / booster clubs
- youth sports organizations
- community groups
- civic groups
- arts groups
- museums
- historic organizations
- foundations
- animal rescues
- local clubs / recreation groups
- selected chambers / associations

### 5.2 Not Acceptable by Default

Reject by default if the page is only:

- a general donation page
- a "give now" page
- a personal fundraising page
- a membership page with no website listing benefit
- a sponsor page with no public business visibility
- a page offering only print exposure, social exposure, or offline recognition

## 6. Hard Qualification Rules

### 6.1 Mandatory Pass Rules

An opportunity may proceed only if all of the following are true or strongly inferable:

- geographically relevant to the target city, metro, county, or approved nearby area
- on a real organization or event website
- site is secure using HTTPS
- there is a public sponsorship page, sponsor page, sponsor package, or sponsor inquiry path
- there is evidence or strong inference that sponsor businesses receive public recognition on the website

### 6.2 Preferred Rules

Prefer opportunities that have:

- one-time pricing
- transparent pricing
- public sponsor page
- linked sponsor logos or linked business names
- clear sponsor tiers
- form or email contact path
- local trust signals
- recent activity or maintenance

### 6.3 Auto-Reject Rules

Reject immediately if any of the following are true:

- site is not HTTPS
- site is broken, abandoned, clearly spammy, or irrelevant
- no geographic relevance
- only donation language with no business attribution
- sponsorship does not include public recognition
- current sponsors are listed but clearly not linked and no package language suggests links
- only social mentions or print mentions are offered
- payment is monthly subscription and not exceptional
- sponsor benefit is only logo exposure with no website listing or link evidence
- there is no public sponsor visibility and no evidence of sponsor web placement

## 7. Search Limits and Coverage Rules

### 7.1 Search Scope

The agent must execute the supplied query bank for the approved target geography.

Approved geography may include:

- primary city
- service area cities
- approved nearby cities

### 7.2 Search Query Source

The agent must use only the provided query bank.

### 7.3 Search Depth

Review up to:

- first 3 pages of search results per query
- maximum 30 candidates per query before deduplication

### 7.4 Domain Crawl Limit

For each candidate domain, inspect up to:

- 10 relevant HTML pages
- 3 relevant PDFs if linked

Stop crawling the domain once sufficient evidence is found to classify the opportunity as:

- Approve
- Reject
- Needs Human Review

## 8. Candidate Collection Rules

For each executed query, the agent must collect candidate results and store:

- title
- url
- root_domain
- search_query_used
- target_city
- target_state

The agent must record which query surfaced each candidate.

The agent must not discard a candidate solely because the result title is vague. The candidate may be reviewed and classified during the crawl stage.

## 9. Execution Workflow

### Step 1: Validate Inputs

Check all required inputs.

If any required input is missing, stop and return the missing field list.

### Step 2: Load Query Bank

Load the approved `query_bank` input.

If `query_bank` is missing, stop and return:

- `status = Missing Required Inputs`
- missing field = `query_bank`

### Step 3: Execute Query Bank

Run each query in the approved query bank.

For each query, collect candidate URLs from up to the first 3 search result pages.

Store:

- query_text
- search engine result title
- url
- root_domain
- target_city
- target_state

### Step 4: Deduplicate Candidates

Deduplicate by:

- root domain
- same sponsorship URL
- same organization or event name

If multiple URLs on the same domain exist, keep:

- the URL most likely to be sponsorship-related
- otherwise the organization homepage

### Step 5: Classify Candidate Type

Assign exactly one Opportunity Type:

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

### Step 6: Find Sponsorship Evidence

On each candidate domain, search for pages containing any of the following:

- sponsor
- sponsors
- become a sponsor
- sponsor us
- sponsorship
- sponsorship package
- sponsor opportunities
- community partners
- partners
- supporters
- annual sponsors
- corporate sponsors
- donor recognition

Also inspect linked PDFs or sponsor packets.

Store:

- Sponsorship URL
- Sponsor Page URL
- linked package or PDF URL where applicable

### Step 7: Determine Public Sponsor Visibility

Decide whether sponsors are displayed publicly.

Set:

- Current Sponsors Displayed Publicly = Yes/No
- Current Sponsors Linked = Yes/No

Set `Displayed Publicly = Yes` if any of the following exist:

- sponsor logos on a public page
- sponsor business names on a public page
- sponsor acknowledgments by tier
- partner or supporter listing page

Set `Current Sponsors Linked = Yes` only if:

- sponsor logo links to an external website
- sponsor business name links to an external website
- package explicitly states website link and a current public example supports it

If sponsors are shown but not linked, set `Current Sponsors Linked = No`.

### Step 8: Extract Pricing and Terms

Extract as many of the following as possible:

- sponsorship amount
- tier names
- cheapest tier
- tier benefits
- payment frequency
- website mention
- linked logo
- linked business name
- event listing
- partner page listing

If pricing is not public, set:

- Payment Amount = Unknown
- Payment Type = Unknown

Add note: `Pricing unknown - contact required`

### Step 9: Identify Submission Path

Extract the best available submission or contact path.

Priority order:

1. dedicated sponsorship form
2. sponsorship contact email
3. sponsorship contact person
4. general contact form tied to sponsor page
5. downloadable PDF package with inquiry instruction
6. phone only

Store:

- Submission Method
- Submission URL
- Contact Email
- Contact Person

### Step 10: Classify Link Opportunity

Use these exact rules.

**Confirmed**

Set `Link Opportunity Status = Confirmed` if at least one is true:

- current sponsor logos or names link to external business sites
- sponsorship package explicitly says "website link," "linked logo," or "linked business name"
- sponsor tier explicitly includes a website listing with link

**Probable**

Set `Probable` if:

- sponsors are publicly displayed on the website
- package or page promises website recognition or online sponsor recognition
- direct outbound link proof is missing, but website placement is clearly part of the benefit

**Unclear**

Set `Unclear` if:

- sponsors appear visually but no link evidence exists
- sponsor page exists but benefits are vague
- recognition is mentioned but no web-specific detail is given

**No Link Opportunity**

Set `No Link Opportunity` if:

- benefits are only print, social, or offline
- donation only
- public business recognition is absent
- sponsor listings exist but no links and no package language indicates a web link
- package clearly excludes website attribution

### Step 11: Determine Local Relevance

Rate local relevance using this rubric.

**High**

The organization or event is located in:

- the client's primary city
- the same metro
- the same county
- an approved service area city

**Medium**

The organization or event is in:

- a nearby approved city
- a clearly adjacent local service market

**Low**

The organization or event is:

- outside the target geography
- regional but not materially connected to the service area
- generic statewide with weak local tie

Set Local Relevance Rating to: `High`, `Medium`, or `Low`.

If Low, reject unless exceptional local value is obvious. In rare cases, mark for human review instead of approval.

### Step 12: Check Site Trust and Freshness

Collect or infer:

- DR
- DA
- estimated traffic
- HTTPS
- freshness signs
- legitimacy

Freshness signs include:

- recent copyright year
- current event dates
- recent sponsor listings
- functioning navigation
- current contact information

If metrics are unavailable, use `Unknown` and continue.

Do not reject solely because DR, DA, or traffic are missing.

### Step 13: Determine Payment Type

Assign exactly one:

- `One-Time` if a single sponsorship purchase covers a fixed event or package without recurring language
- `Annual` if yearly renewal or yearly sponsor program is required
- `Monthly` if billed monthly
- `Recurring` if repeating but not clearly monthly or annual
- `Unknown` if not stated

### Step 14: Apply Decision Logic

Apply this order.

**Approve**

Set `Decision = Approve` only if all are true:

- local relevance is High or acceptable Medium
- sponsors are publicly visible or sponsor package clearly exists
- link opportunity is Confirmed or Probable
- site is HTTPS
- site appears legitimate
- payment type is One-Time, or Annual at acceptable cost with strong local value
- submission path or contact path exists

**Needs Human Review**

Set `Decision = Needs Human Review` if any are true:

- price exceeds budget
- price is annual or recurring but the opportunity is highly local
- link opportunity is Unclear but overall value is strong
- pricing is unknown but sponsor evidence is strong
- chamber or association is costly or recurring
- sponsors are inconsistently linked
- terms are incomplete but promising
- relevance is strong and site is legitimate, but one critical field is missing

**Reject**

Set `Decision = Reject` if any are true:

- local relevance is Low
- no sponsor visibility and no sponsor package evidence
- link opportunity is No Link Opportunity
- only donation with no business attribution
- only logo exposure with no web listing or link evidence
- site is insecure
- site is broken, spammy, or abandoned
- recurring payment is clearly poor value
- no practical contact path and no package details

## 10. Scoring Model

After decisioning, calculate a priority score from 0 to 100.

### Weights

- Local Relevance: 35
- Backlink Opportunity Certainty: 30
- Price/Payment Acceptability: 20
- Site Trust/Authority: 10
- Traffic: 5

### Scoring Rubric

**Local Relevance (0 to 35)**

- High = 35
- Medium = 20
- Low = 0

**Backlink Opportunity Certainty (0 to 30)**

- Confirmed = 30
- Probable = 20
- Unclear = 8
- No Link Opportunity = 0

**Price/Payment Acceptability (0 to 20)**

- One-Time and within budget = 20
- Annual but within budget = 10
- Unknown pricing = 8
- Above budget = 5
- Monthly or poor recurring = 0

**Site Trust/Authority (0 to 10)**

- strong legitimacy and decent authority = 10
- legitimate but modest = 6
- weak or unclear = 3
- spammy or broken = 0

**Traffic (0 to 5)**

- meaningful traffic = 5
- low traffic but real = 3
- unknown = 2
- negligible or spam signal = 0

Store the final score in notes or as an added column when needed.

## 11. Special Rules

### 11.1 Chambers of Commerce

Do not prioritize chambers first.

Keep chambers if they are:

- highly local
- likely to include a sponsor or member listing with links or website visibility
- priced visibly or discoverably

Flag for review if they are:

- expensive
- annual
- above budget
- unclear on link inclusion

Do not reject only because they are expensive.

### 11.2 Pricing Hidden but Sponsor Evidence Strong

If all are true:

- sponsor page exists
- sponsors are publicly visible
- linked sponsors exist or website recognition is strongly implied
- contact path exists
- pricing is not public

Then keep the opportunity and set:

- `Decision = Needs Human Review`
- Add note: `Promising - outreach needed for pricing`

### 11.3 Annual Programs

Do not auto-approve annual programs unless they are clearly strong.

Annual sponsorships should usually be:

- review-worthy
- not automatic rejects
- approved only if value is strong and budget fit is clear

### 11.4 Visible Sponsors but No Clickable Links

If sponsors are visible but not linked:

- check package language
- check PDFs
- check sponsor tier descriptions

If no evidence of website link exists, set:

- `Link Opportunity Status = Unclear` or `No Link Opportunity`

Usually reject unless strong evidence suggests linked website placement is included elsewhere.

### 11.5 Non-HTTPS Sites

Auto-reject.

## 12. Data Recording Rules

### 12.1 If a Field Cannot Be Found

Use:

- `Unknown` for structured fields
- a short explanation in Notes

Do not leave cells blank unless truly not applicable.

### 12.2 Evidence Notes

For each non-rejected opportunity, include one short evidence note covering:

- why it is locally relevant
- what proves or suggests the backlink
- what pricing or payment info was found
- how to submit or contact

### 12.3 One Organization, Multiple Opportunities

If one domain has multiple materially different sponsor programs, create separate rows only if:

- pricing differs
- sponsor page differs
- event differs
- decision could differ

Otherwise, keep one best row.

## 13. Human Review Triggers

Set Human Review Trigger when any of the following occur:

- cost exceeds approved budget
- annual or recurring payment required
- pricing unknown
- backlink not fully confirmed
- chamber or association opportunity
- terms incomplete
- public sponsor page hard to verify
- metrics weak but relevance strong
- highly local site but commercial benefit unclear

If none apply, set: `Human Review Trigger = None`

## 14. QA Checklist Before Completion

Before marking the batch complete, every approved or review-worthy row must have:

- local relevance rating assigned
- sponsorship page or sponsor evidence identified
- public sponsor visibility checked
- link opportunity status assigned
- payment amount or pricing status recorded
- payment type assigned
- submission path or contact method recorded
- HTTPS recorded
- decision assigned
- notes added

If any required output field is missing for an approved or review-worthy opportunity, do not finalize until the field is completed or marked `Unknown`.

## 15. Completion Standard

An opportunity is considered usable only when the agent can verify or strongly infer all of the following:

- the organization is local to the target geography
- sponsors are publicly recognized or sponsor recognition is clearly offered
- a website backlink is confirmed or probable
- pricing is known or pricing status is documented
- payment type is documented
- a contact or submission path is available
- the site is legitimate and secure

## 16. Decision Examples

**Example A — Approve**

- local marathon in target city
- sponsor page exists
- current sponsors link out
- bronze tier includes linked logo
- $100 one-time
- HTTPS and legitimate

Decision: **Approve**

**Example B — Needs Human Review**

- historic foundation in target city
- sponsor page exists
- sponsor links visible
- lowest package is $500 annual
- highly trusted and very local

Decision: **Needs Human Review**

**Example C — Reject**

- donation page only
- no sponsor page
- no business listing
- no link evidence

Decision: **Reject**
