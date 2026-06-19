import "server-only";
import Database from "better-sqlite3";
import path from "path";
import { randomUUID } from "crypto";
import { mkdirSync, existsSync } from "fs";
import type { RunResult } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "opportunities.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }
    db = new Database(DB_PATH);
    // Configure SQLite for better concurrency and performance
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL"); // Faster writes, still safe
    db.pragma("cache_size = -64000"); // 64MB cache
    db.pragma("temp_store = MEMORY");
    db.pragma("mmap_size = 30000000"); // 30MB mmap
    db.pragma("page_size = 4096");
    db.pragma("busy_timeout = 5000"); // 5 second timeout for locks
    initializeSchema();
  }
  return db;
}

function initializeSchema(): void {
  const database = db!;

  database.exec(`
    CREATE TABLE IF NOT EXISTS opportunities (
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
      dr INTEGER,
      da INTEGER,
      organic_traffic INTEGER,
      https TEXT,
      freshness_notes TEXT,
      notes TEXT,
      decision TEXT,
      human_review_trigger TEXT,
      score REAL,
      search_query_used TEXT,
      client_origin TEXT,
      run_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_used_by_client TEXT,
      last_used_at INTEGER,
      UNIQUE(domain, sponsorship_url)
    );

    CREATE INDEX IF NOT EXISTS idx_opportunities_city ON opportunities(city);
    CREATE INDEX IF NOT EXISTS idx_opportunities_state ON opportunities(state);
    CREATE INDEX IF NOT EXISTS idx_opportunities_decision ON opportunities(decision);
    CREATE INDEX IF NOT EXISTS idx_opportunities_created ON opportunities(created_at);

    CREATE TABLE IF NOT EXISTS research_runs (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      target_city TEXT NOT NULL,
      target_state TEXT NOT NULL,
      run_date INTEGER NOT NULL,
      total_candidates INTEGER,
      approved_count INTEGER,
      review_count INTEGER,
      rejected_count INTEGER,
      queries_used TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runs_client ON research_runs(client_name);
    CREATE INDEX IF NOT EXISTS idx_runs_city_state ON research_runs(target_city, target_state);
    CREATE INDEX IF NOT EXISTS idx_runs_created ON research_runs(created_at);
  `);
}

export interface StoredOpportunity {
  id: string;
  domain: string;
  sponsorship_url: string;
  sponsor_page_url: string;
  opportunity_name?: string;
  opportunity_type?: string;
  city: string;
  state: string;
  local_relevance_rating?: string;
  local_relevance_notes?: string;
  current_sponsors_displayed?: string;
  current_sponsors_linked?: string;
  link_opportunity_status?: string;
  link_evidence?: string;
  payment_amount?: string;
  payment_type?: string;
  cheapest_tier_with_link?: string;
  tier_name?: string;
  submission_method?: string;
  submission_url?: string;
  contact_email?: string;
  contact_person?: string;
  dr: number | null;
  da: number | null;
  organic_traffic: number | null;
  https?: string;
  freshness_notes?: string;
  notes?: string;
  decision?: string;
  human_review_trigger?: string;
  score?: number;
  search_query_used?: string;
  client_origin?: string;
  run_id?: string;
  created_at: number;
  updated_at: number;
  last_used_by_client?: string | null;
  last_used_at?: number | null;
}

export async function saveOpportunitiesToDb(
  runResult: RunResult,
  clientName: string,
): Promise<{ success: boolean; saved_count: number; run_id: string }> {
  const database = getDb();
  const runId = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  try {
    const saveOpportunity = database.prepare(`
      INSERT INTO opportunities (
        id, domain, sponsorship_url, sponsor_page_url, opportunity_name,
        opportunity_type, city, state, local_relevance_rating,
        local_relevance_notes, current_sponsors_displayed, current_sponsors_linked,
        link_opportunity_status, link_evidence, payment_amount, payment_type,
        cheapest_tier_with_link, tier_name, submission_method, submission_url,
        contact_email, contact_person, dr, da, organic_traffic, https,
        freshness_notes, notes, decision, human_review_trigger, score,
        search_query_used, client_origin, run_id, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
      ON CONFLICT(domain, sponsorship_url) DO UPDATE SET
        updated_at = excluded.updated_at,
        client_origin = excluded.client_origin,
        run_id = excluded.run_id,
        last_used_by_client = NULL,
        last_used_at = NULL
    `);

    const saveRun = database.prepare(`
      INSERT INTO research_runs (
        id, client_name, target_city, target_state, run_date,
        total_candidates, approved_count, review_count, rejected_count,
        queries_used, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Start transaction
    const transaction = database.transaction(() => {
      // Save research run
      saveRun.run(
        runId,
        clientName,
        runResult.summary.target_city,
        runResult.summary.target_state,
        Math.floor(new Date(runResult.summary.run_date).getTime() / 1000),
        runResult.summary.total_candidates_reviewed,
        runResult.summary.approved_count,
        runResult.summary.review_count,
        runResult.summary.rejected_count,
        JSON.stringify(runResult.summary.queries_used),
        now,
      );

      // Save opportunities (only approved and review)
      let savedCount = 0;
      for (const opp of runResult.opportunities) {
        if (opp.Decision === "Approve" || opp.Decision === "Needs Human Review") {
          const id = randomUUID();
          saveOpportunity.run(
            id,
            opp.Domain,
            opp["Sponsorship URL"],
            opp["Sponsor Page URL"],
            opp["Opportunity Name"],
            opp["Opportunity Type"],
            opp.City,
            opp.State,
            opp["Local Relevance Rating"],
            opp["Local Relevance Notes"],
            opp["Current Sponsors Displayed Publicly"],
            opp["Current Sponsors Linked"],
            opp["Link Opportunity Status"],
            opp["Link Evidence"],
            opp["Payment Amount"],
            opp["Payment Type"],
            opp["Cheapest Tier With Link"],
            opp["Tier Name"],
            opp["Submission Method"],
            opp["Submission URL"],
            opp["Contact Email"],
            opp["Contact Person"],
            opp.DR === "Unknown" ? null : opp.DR,
            opp.DA === "Unknown" ? null : opp.DA,
            opp.Traffic === "Unknown" ? null : opp.Traffic,
            opp.HTTPS,
            opp["Freshness / Site Quality Notes"],
            opp.Notes,
            opp.Decision,
            opp["Human Review Trigger"],
            opp.Score,
            opp["Search Query Used"],
            clientName,
            runId,
            now,
            now,
          );
          savedCount++;
        }
      }

      return savedCount;
    });

    const savedCount = transaction();

    return {
      success: true,
      saved_count: savedCount,
      run_id: runId,
    };
  } catch (error) {
    console.error("Error saving opportunities to database:", error);
    throw error;
  }
}

export interface SearchFilters {
  city?: string;
  state?: string;
  search?: string;
  decision?: string;
  limit?: number;
  offset?: number;
  sortBy?: "created" | "dr" | "traffic" | "score";
  sortOrder?: "ASC" | "DESC";
}

export async function searchOpportunities(
  filters: SearchFilters,
): Promise<{
  opportunities: StoredOpportunity[];
  total: number;
}> {
  const database = getDb();

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  const sortBy = filters.sortBy || "created";
  const sortOrder = filters.sortOrder || "DESC";

  // Build WHERE clause
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.city) {
    conditions.push("city = ?");
    params.push(filters.city);
  }

  if (filters.state) {
    conditions.push("state = ?");
    params.push(filters.state);
  }

  if (filters.decision) {
    conditions.push("decision = ?");
    params.push(filters.decision);
  }

  if (filters.search) {
    conditions.push(
      "(domain LIKE ? OR opportunity_name LIKE ? OR contact_email LIKE ?)",
    );
    const searchTerm = `%${filters.search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Map sort columns
  const sortColumn =
    {
      created: "created_at",
      dr: "dr",
      traffic: "organic_traffic",
      score: "score",
    }[sortBy] || "created_at";

  // Get total count
  const countQuery = database.prepare(
    `SELECT COUNT(*) as count FROM opportunities ${whereClause}`,
  );
  const countResult = countQuery.get(...params) as { count: number };
  const total = countResult.count;

  // Get paginated results
  const query = database.prepare(
    `SELECT * FROM opportunities ${whereClause} ORDER BY ${sortColumn} ${sortOrder} LIMIT ? OFFSET ?`,
  );

  const opportunities = query.all(
    ...params,
    limit,
    offset,
  ) as StoredOpportunity[];

  return {
    opportunities,
    total,
  };
}

export async function getOpportunityById(id: string): Promise<StoredOpportunity | null> {
  const database = getDb();
  const query = database.prepare("SELECT * FROM opportunities WHERE id = ?");
  const result = query.get(id) as StoredOpportunity | undefined;
  return result || null;
}

export async function markOpportunityAsUsed(
  id: string,
  clientName: string,
): Promise<boolean> {
  const database = getDb();
  const now = Math.floor(Date.now() / 1000);

  const query = database.prepare(
    `UPDATE opportunities SET last_used_by_client = ?, last_used_at = ?, updated_at = ? WHERE id = ?`,
  );

  const result = query.run(clientName, now, now, id);
  return (result.changes || 0) > 0;
}

export interface ResearchRun {
  id: string;
  client_name: string;
  target_city: string;
  target_state: string;
  run_date: number;
  total_candidates: number | null;
  approved_count: number | null;
  review_count: number | null;
  rejected_count: number | null;
  queries_used: string;
  created_at: number;
}

export async function getResearchRuns(
  limit: number = 50,
  offset: number = 0,
): Promise<{ runs: ResearchRun[]; total: number }> {
  const database = getDb();

  const countQuery = database.prepare("SELECT COUNT(*) as count FROM research_runs");
  const countResult = countQuery.get() as { count: number };
  const total = countResult.count;

  const query = database.prepare(
    `SELECT * FROM research_runs ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  );
  const runs = query.all(limit, offset) as ResearchRun[];

  return { runs, total };
}

export async function getInventoryStats(): Promise<{
  totalOpportunities: number;
  cityCounts: { city: string; count: number }[];
  stateCounts: { state: string; count: number }[];
  decisionCounts: {
    Approve: number;
    "Needs Human Review": number;
    Reject: number;
  };
  avgScore: number | null;
}> {
  const database = getDb();

  const totalQuery = database.prepare("SELECT COUNT(*) as count FROM opportunities");
  const totalResult = totalQuery.get() as { count: number };

  const citiesQuery = database.prepare(
    `SELECT city, COUNT(*) as count FROM opportunities GROUP BY city ORDER BY count DESC LIMIT 10`,
  );
  const cityCounts = citiesQuery.all() as { city: string; count: number }[];

  const statesQuery = database.prepare(
    `SELECT state, COUNT(*) as count FROM opportunities GROUP BY state ORDER BY count DESC LIMIT 10`,
  );
  const stateCounts = statesQuery.all() as { state: string; count: number }[];

  const decisionsQuery = database.prepare(
    `SELECT decision, COUNT(*) as count FROM opportunities GROUP BY decision`,
  );
  const decisions = decisionsQuery.all() as { decision: string; count: number }[];

  const decisionCounts = {
    Approve: 0,
    "Needs Human Review": 0,
    Reject: 0,
  };

  for (const d of decisions) {
    if (d.decision in decisionCounts) {
      decisionCounts[d.decision as keyof typeof decisionCounts] = d.count;
    }
  }

  const avgQuery = database.prepare("SELECT AVG(score) as avg FROM opportunities");
  const avgResult = avgQuery.get() as { avg: number | null };

  return {
    totalOpportunities: totalResult.count,
    cityCounts,
    stateCounts,
    decisionCounts,
    avgScore: avgResult.avg,
  };
}

export async function getCitiesAndStates(): Promise<{
  cities: string[];
  states: string[];
}> {
  const database = getDb();

  const citiesQuery = database.prepare(
    `SELECT DISTINCT city FROM opportunities ORDER BY city`,
  );
  const cities = (citiesQuery.all() as { city: string }[]).map((c) => c.city);

  const statesQuery = database.prepare(
    `SELECT DISTINCT state FROM opportunities ORDER BY state`,
  );
  const states = (statesQuery.all() as { state: string }[]).map((s) => s.state);

  return { cities, states };
}

// Checkpoint WAL file periodically to prevent bloat
export async function checkpointWAL(): Promise<void> {
  const database = getDb();
  try {
    // RESTART checkpoint: blocks until all readers complete, then folds WAL into main DB
    database.pragma("wal_checkpoint(RESTART)");
  } catch (error) {
    console.warn("WAL checkpoint failed (non-critical):", error);
  }
}
