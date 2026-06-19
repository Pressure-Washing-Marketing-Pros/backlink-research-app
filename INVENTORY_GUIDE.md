# Sponsorship Opportunity Inventory - Quick Start Guide

## Overview

Your backlink research app now has a **persistent inventory dashboard** where research results are automatically saved and can be searched, filtered, and reused for future clients in the same location.

Instead of research disappearing after each run, opportunities now build up in a location-based library that grows over time.

## How to Use

### Saving Research Results

1. **Run Research** — Fill out the form and click "Run Research" as normal
2. **Review Results** — Edit decisions and notes directly in the table if needed
3. **Save to Inventory** — Click the green "Save to Inventory" button
4. **Confirm** — Dialog shows what will be saved (approved + needs review opportunities)
5. **Done** — Success message appears; click dashboard link or continue

✅ Research is now saved. Rejected opportunities are not saved (only approved/review).

### Finding Saved Opportunities

**Method 1: From Research Page**
- After saving, click "View Inventory" in the success message
- Or click "View Inventory" button in header

**Method 2: Direct Link**
- Visit `/dashboard` directly

### Using the Dashboard

#### Filters (Left Side)
- **Search** — Find by domain, opportunity name, or email
- **City** — Select from existing cities in your inventory
- **State** — Select from existing states
- **Decision** — Filter by Approved, Needs Review, or All
- **Sort By** — Date Added, Domain Rating, Traffic, or Score
- **Order** — Newest first or oldest first

#### Results Table
- **Columns:** Domain | Location | Decision | DR | Traffic | Method | Action
- **Click domain** to expand and see full details
- **"Reuse" button** — Mark as used and track which client reused it
- **Pagination** — 50 results per page

#### Stats Sidebar (Right Side)
- **Total Opportunities** in your inventory
- **Decision Breakdown** — How many approved/review/rejected
- **Average Score** of all opportunities
- **Top 5 Cities** by opportunity count
- **Top 5 States** by opportunity count

### Reusing Opportunities for New Clients

Example workflow:
1. Get new client: "Help us find sponsorships in Cleveland, Ohio"
2. Go to `/dashboard`
3. Select State: "OH", City: "Cleveland"
4. Browse results (sorted newest first)
5. Click domains to see full details
6. For each relevant opportunity, click "Reuse" and enter client name
7. Export selected results to CSV for client
8. Run fresh research if you find gaps in coverage

## What Gets Saved?

✅ **Saved to Inventory:**
- Approved opportunities
- Opportunities marked "Needs Human Review"

❌ **Not Saved:**
- Rejected opportunities
- Only saved once per (domain, sponsorship_url) combination
- Duplicates update existing records instead of creating new ones

## Data Stored

For each opportunity, we keep:
- Domain and sponsorship page URL
- Opportunity name and type
- City and state
- Link status (confirmed, probable, etc.)
- Contact: person name, email, submission method
- Metrics: Domain Rating, Organic Traffic, HTTPS status
- Payment: amount, type, tier
- Freshness notes and crawl notes
- Decision status and score
- Which research run found it
- When last used and by which client

## Benefits

### Save Time
- Don't research the same cities twice
- Find what you've already learned instantly
- Reduce duplicate work

### Build Value
- Every research run adds to your library
- The app gets smarter/more valuable over time
- Inventory becomes an internal asset

### Track Reuse
- See which opportunities get reused most
- Understand which cities/types are most valuable
- Make better decisions on where to focus research

## Tips

### Best Practices
1. **Be consistent with city/state names** — The system groups by exact match
2. **Run fresh research for new needs** — The inventory complements research, doesn't replace it
3. **Mark as reused** — Helps track which opportunities are most valuable
4. **Review decisions** — Edit Approved/Rejected status in research before saving

### Common Workflows

**Scenario 1: Repeat Location**
```
Client 1: Cleveland, OH research run
↓ Save to inventory
↓
Client 2: Also needs Cleveland, OH
↓ Check /dashboard, filter by Cleveland + OH
↓ Find 20+ pre-qualified opportunities
↓ Reuse + save 2 hours of research work
```

**Scenario 2: Geographic Expansion**
```
Have 10 years of local data in your area
↓ Search inventory dashboard by state
↓ See patterns: which cities have most opportunities
↓ Use data to plan next expansion
```

**Scenario 3: Niche Research**
```
Successfully research "tech events" in Dallas
↓ Save to inventory
↓
Later: "sports events" in Dallas
↓ Can reference "tech events" data for comparison
↓ Make research faster with historical context

## Technology

- **Database:** SQLite (file-based, no external service)
- **Storage:** `/data/opportunities.db` (git-ignored, not committed)
- **Location:** Local to your app, automatically created
- **Sync:** All instances share the same database file
- **Backup:** Include `/data/` in your backup strategy if needed

## Future Possibilities

These could be added later if useful:
- Bulk tagging/categorization
- Opportunity flagging/favoriting
- Export saved searches
- Historical tracking (see how opportunities change over time)
- Scheduled metric updates
- Integration with outreach tools

## Questions?

- **Where is the database?** — `/data/opportunities.db` (created automatically)
- **Can I delete opportunities?** — Not yet built, but can be added
- **Can I share inventory with team?** — Currently single-instance; multi-user support could be added
- **Does it slow down research?** — No, saving is optional and happens after research
- **Can I migrate to PostgreSQL later?** — Yes, schema is compatible

---

**Start using it:** After running research, click "Save to Inventory" → Visit `/dashboard` to search and reuse!
