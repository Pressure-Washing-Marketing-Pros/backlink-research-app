import "server-only";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { randomUUID } from "crypto";
import type { RunResult } from "./types";
import { SCHEMA_STATEMENTS } from "./schema";

// Lazy initialization: do NOT call neon() at module top level. Next.js evaluates
// module code at build time, and neon() throws if DATABASE_URL is unset — which
// would crash `next build` before env vars are provisioned.
let _sql: NeonQueryFunction<false, false> | null = null;

function getSql(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL is not set. Provision Neon Postgres (vercel integration add neon) and run `vercel env pull .env.local`.",
      );
    }
    _sql = neon(url);
  }
  return _sql;
}

// ---------------------------------------------------------------------------
// Row mappers — Postgres returns BIGINT as strings and numeric/decimal as
// strings; coerce to the number shapes the app expects.
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function mapOpportunity(row: Record<string, unknown>): StoredOpportunity {
  return {
    ...(row as unknown as StoredOpportunity),
    dr: toNum(row.dr),
    da: toNum(row.da),
    organic_traffic: toNum(row.organic_traffic),
    score: toNum(row.score) ?? undefined,
    created_at: toNum(row.created_at) ?? 0,
    updated_at: toNum(row.updated_at) ?? 0,
    last_used_at: row.last_used_at == null ? null : toNum(row.last_used_at),
    last_checked_at: row.last_checked_at == null ? null : toNum(row.last_checked_at),
    last_refreshed_at: row.last_refreshed_at == null ? null : toNum(row.last_refreshed_at),
  };
}

// Normalizes a URL for dedup comparisons: strips protocol, www, trailing
// slash, and query string so equivalent URLs collapse to the same key.
export function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.trim().toLowerCase();
  }
}

function mapRun(row: Record<string, unknown>): ResearchRun {
  return {
    id: String(row.id),
    client_name: String(row.client_name),
    target_city: String(row.target_city),
    target_state: String(row.target_state),
    run_date: toNum(row.run_date) ?? 0,
    total_candidates: toNum(row.total_candidates),
    approved_count: toNum(row.approved_count),
    review_count: toNum(row.review_count),
    rejected_count: toNum(row.rejected_count),
    queries_used: row.queries_used == null ? "" : String(row.queries_used),
    created_at: toNum(row.created_at) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/**
 * Create tables and indexes if they don't exist. Idempotent — safe to re-run.
 * Intended to be called once from a migration script (see scripts/migrate.mjs),
 * not on the request path.
 */
export async function initializeSchema(): Promise<void> {
  const sql = getSql();
  for (const stmt of SCHEMA_STATEMENTS) {
    await sql.query(stmt);
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  sponsorship_tiers?: string;
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
  location?: string;
  normalized_url?: string;
  review_reasons?: string;
  sensitive_category?: string | null;
  duplicate_of?: string | null;
  last_checked_at?: number | null;
  last_refreshed_at?: number | null;
  county?: string;
  resolved_location_scope?: string;
  location_confidence?: string;
  location_evidence?: string;
  source_query_scopes?: string;
}

export interface SearchFilters {
  city?: string;
  county?: string;
  locationScope?: string;
  state?: string;
  search?: string;
  decision?: string;
  minDr?: number;
  maxDr?: number;
  paymentType?: string;
  limit?: number;
  offset?: number;
  sortBy?: "created" | "dr" | "traffic" | "payment_amount" | "score";
  sortOrder?: "ASC" | "DESC";
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

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface SkippedDuplicate {
  domain: string;
  reason: string;
}

export async function saveOpportunitiesToDb(
  runResult: RunResult,
  clientName: string,
): Promise<{
  success: boolean;
  saved_count: number;
  run_id: string;
  skipped_duplicates: number;
  skipped_domains: SkippedDuplicate[];
}> {
  const sql = getSql();
  const runId = randomUUID();
  const now = Math.floor(Date.now() / 1000);

  // Build all statements, then run them as a single atomic HTTP transaction.
  const queries = [
    sql.query(
      `INSERT INTO research_runs (
        id, client_name, target_city, target_state, run_date,
        total_candidates, approved_count, review_count, rejected_count,
        queries_used, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
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
      ],
    ),
  ];

  // Dedup against existing inventory before inserting: same domain, same
  // sponsorship URL, or same normalized URL is treated as an update to the
  // existing record rather than a new row, so re-running research doesn't
  // clutter the inventory with repeats.
  const existingRows = (await sql.query(
    `SELECT id, domain, sponsorship_url, normalized_url, state, city, county, location,
            resolved_location_scope, location_confidence, location_evidence, source_query_scopes,
            dr, organic_traffic
     FROM opportunities`,
  )) as {
    id: string;
    domain: string;
    sponsorship_url: string;
    normalized_url: string | null;
    state: string;
    city: string | null;
    county: string | null;
    location: string | null;
    resolved_location_scope: string | null;
    location_confidence: string | null;
    location_evidence: string | null;
    source_query_scopes: string | null;
    dr: number | string | null;
    organic_traffic: number | string | null;
  }[];
  // City is the most specific resolvable scope, then county, then statewide;
  // "unclear" is the least specific. When a duplicate is merged, the more
  // specific of the two resolved locations wins — never the broadest query
  // source that happened to run last.
  const mergeScopes = (existing: string | null, incoming: string): string =>
    Array.from(
      new Set(
        [...(existing ?? "").split(","), ...incoming.split(",")]
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ).join(", ");
  const byDomain = new Map<string, typeof existingRows[number]>();
  const byNormalizedUrl = new Map<string, typeof existingRows[number]>();
  for (const row of existingRows) {
    if (row.domain) byDomain.set(row.domain.toLowerCase(), row);
    if (row.normalized_url) byNormalizedUrl.set(row.normalized_url, row);
  }

  let savedCount = 0;
  let skippedDuplicates = 0;
  const skippedDomains: SkippedDuplicate[] = [];
  for (const opp of runResult.opportunities) {
    if (opp.Decision !== "Approve" && opp.Decision !== "Needs Human Review") continue;

    const sponsorshipUrl = opp["Sponsorship URL"];
    const normalizedUrl = normalizeUrlForDedup(sponsorshipUrl);
    const domainKey = opp.Domain.toLowerCase();
    const exactDuplicate = byNormalizedUrl.get(normalizedUrl);
    const domainDuplicate = byDomain.get(domainKey);
    // A domain that already exists in inventory is always a duplicate —
    // regardless of state/location formatting differences between runs —
    // so it's merged into the existing record instead of ever inserting a
    // second row for the same domain.
    const duplicate = exactDuplicate ?? domainDuplicate;

    if (duplicate) {
      // Same domain/URL already in inventory — refresh the existing record
      // instead of inserting a near-duplicate row. Keep whichever resolved
      // location (existing vs. this run's) is more specific.
      const existingScope = duplicate.resolved_location_scope || "unclear";
      const newScope = opp["Resolved Location Scope"];
      const useNewLocation = (SCOPE_SPECIFICITY[newScope] ?? 0) >= (SCOPE_SPECIFICITY[existingScope] ?? 0);
      const finalCity = useNewLocation ? opp.City : duplicate.city ?? "";
      const finalCounty = useNewLocation ? opp.County : duplicate.county ?? "";
      const finalLocation = useNewLocation ? opp.Location : duplicate.location ?? opp.Location;
      const finalScope = useNewLocation ? newScope : existingScope;
      const finalConfidence = useNewLocation ? opp["Location Confidence"] : duplicate.location_confidence ?? opp["Location Confidence"];
      const finalEvidence = useNewLocation ? opp["Location Evidence"] : duplicate.location_evidence ?? opp["Location Evidence"];
      const finalScopes = mergeScopes(duplicate.source_query_scopes, opp["Source Query Scopes"]);
      const reason = exactDuplicate
        ? "duplicate sponsorship URL already exists in inventory"
        : "duplicate domain already exists in inventory";

      // Never let a null/failed Ahrefs lookup on this save overwrite a
      // previously-good DR/traffic value already stored on the record.
      const newDr = opp.DR === "Unknown" ? null : opp.DR;
      const newTraffic = opp.Traffic === "Unknown" ? null : opp.Traffic;
      const finalDr = newDr !== null ? newDr : duplicate.dr !== null ? Number(duplicate.dr) : null;
      const finalTraffic =
        newTraffic !== null ? newTraffic : duplicate.organic_traffic !== null ? Number(duplicate.organic_traffic) : null;

      queries.push(
        sql.query(
          `UPDATE opportunities SET
             dr = $1, organic_traffic = $2, payment_amount = $3, payment_type = $4,
             submission_method = $5, contact_email = $6, contact_page_url = $7, contact_page_fallback_used = $8,
             link_evidence = $9, link_opportunity_status = $10, decision = $11, human_review_trigger = $12,
             score = $13, notes = $14, normalized_url = $15, location = $16,
             city = $17, county = $18, resolved_location_scope = $19,
             location_confidence = $20, location_evidence = $21, source_query_scopes = $22,
             run_id = $23, updated_at = $24, last_checked_at = $24
           WHERE id = $25`,
          [
            finalDr,
            finalTraffic,
            opp["Payment Amount"],
            opp["Payment Type"],
            opp["Submission Method"],
            opp["Contact Email"],
            opp["Contact Page URL"],
            opp["Contact Page Fallback Used"],
            opp["Link Evidence"],
            opp["Link Opportunity Status"],
            opp.Decision,
            opp["Human Review Trigger"],
            opp.Score,
            `${opp.Notes} Skipped duplicate insert — existing record updated instead (${reason}).`,
            normalizedUrl,
            finalLocation,
            finalCity,
            finalCounty,
            finalScope,
            finalConfidence,
            finalEvidence,
            finalScopes,
            runId,
            now,
            duplicate.id,
          ],
        ),
      );
      skippedDuplicates++;
      skippedDomains.push({ domain: opp.Domain, reason });
      continue;
    }

    const id = randomUUID();
    const decision = opp.Decision;
    const humanReviewTrigger = opp["Human Review Trigger"];
    const notes = opp.Notes;
    const duplicateOfId = null;
    queries.push(
      sql.query(
        `INSERT INTO opportunities (
          id, domain, sponsorship_url, sponsor_page_url, opportunity_name,
          opportunity_type, city, county, state, location, local_relevance_rating,
          local_relevance_notes, current_sponsors_displayed, current_sponsors_linked,
          link_opportunity_status, link_evidence, payment_amount, payment_type,
          cheapest_tier_with_link, tier_name, submission_method, submission_url,
          contact_email, contact_person, contact_page_url, contact_page_fallback_used, dr, da, organic_traffic, https,
          freshness_notes, notes, decision, human_review_trigger, score,
          search_query_used, client_origin, run_id, normalized_url, duplicate_of,
          resolved_location_scope, location_confidence, location_evidence, source_query_scopes,
          last_checked_at, last_refreshed_at, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30,
          $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, $41, $42, $43, $44, $45, $46, $47, $48
        )
        ON CONFLICT (domain, sponsorship_url) DO UPDATE SET
          updated_at = EXCLUDED.updated_at,
          last_checked_at = EXCLUDED.last_checked_at,
          client_origin = EXCLUDED.client_origin,
          run_id = EXCLUDED.run_id,
          last_used_by_client = NULL,
          last_used_at = NULL`,
        [
          id,
          opp.Domain,
          sponsorshipUrl,
          opp["Sponsor Page URL"],
          opp["Opportunity Name"],
          opp["Opportunity Type"],
          opp.City,
          opp.County,
          opp.State,
          opp.Location,
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
          opp["Contact Page URL"],
          opp["Contact Page Fallback Used"],
          opp.DR === "Unknown" ? null : opp.DR,
          opp.DA === "Unknown" ? null : opp.DA,
          opp.Traffic === "Unknown" ? null : opp.Traffic,
          opp.HTTPS,
          opp["Freshness / Site Quality Notes"],
          notes,
          decision,
          humanReviewTrigger,
          opp.Score,
          opp["Search Query Used"],
          clientName,
          runId,
          normalizedUrl,
          duplicateOfId,
          opp["Resolved Location Scope"],
          opp["Location Confidence"],
          opp["Location Evidence"],
          opp["Source Query Scopes"],
          now,
          now,
          now,
          now,
        ],
      ),
    );
    // Track newly-added rows in-memory so later opportunities in the same
    // run that share a domain/URL are also treated as duplicates.
    const trackedRow = {
      id,
      domain: opp.Domain,
      sponsorship_url: sponsorshipUrl,
      normalized_url: normalizedUrl,
      state: opp.State,
      city: opp.City,
      county: opp.County,
      location: opp.Location,
      resolved_location_scope: opp["Resolved Location Scope"],
      location_confidence: opp["Location Confidence"],
      location_evidence: opp["Location Evidence"],
      source_query_scopes: opp["Source Query Scopes"],
      dr: opp.DR === "Unknown" ? null : opp.DR,
      organic_traffic: opp.Traffic === "Unknown" ? null : opp.Traffic,
    };
    byDomain.set(domainKey, trackedRow);
    byNormalizedUrl.set(normalizedUrl, trackedRow);
    savedCount++;
  }

  try {
    await sql.transaction(queries);
  } catch (error) {
    console.error("Error saving opportunities to database:", error);
    throw error;
  }

  return {
    success: true,
    saved_count: savedCount,
    run_id: runId,
    skipped_duplicates: skippedDuplicates,
    skipped_domains: skippedDomains,
  };
}

export async function markOpportunityAsUsed(
  id: string,
  clientName: string,
): Promise<boolean> {
  const sql = getSql();
  const now = Math.floor(Date.now() / 1000);

  const rows = await sql.query(
    `UPDATE opportunities
       SET last_used_by_client = $1, last_used_at = $2, updated_at = $3
     WHERE id = $4
     RETURNING id`,
    [clientName, now, now, id],
  );
  return rows.length > 0;
}

export async function deleteOpportunity(id: string): Promise<boolean> {
  const sql = getSql();
  const rows = await sql.query(
    `DELETE FROM opportunities WHERE id = $1 RETURNING id`,
    [id],
  );
  return rows.length > 0;
}

/** Deletes every opportunity in the inventory (research_runs history is kept). */
export async function clearInventory(): Promise<{ deletedCount: number }> {
  const sql = getSql();
  const rows = await sql.query(`DELETE FROM opportunities RETURNING id`);
  return { deletedCount: rows.length };
}

export async function updateOpportunityDecision(
  id: string,
  decision: string,
  reviewNote?: string,
  rejectionReason?: string,
  rejectionNotes?: string,
): Promise<boolean> {
  const sql = getSql();
  const now = Math.floor(Date.now() / 1000);
  const reviewStatus =
    decision === "Approve"
      ? "Approved"
      : decision === "Reject"
        ? "Rejected"
        : "Needs Review";
  const rows = await sql.query(
    `UPDATE opportunities
       SET decision = $1,
           review_status = $2,
           rejection_reason = CASE WHEN $1 = 'Reject' THEN $3 ELSE NULL END,
           rejection_notes = CASE WHEN $1 = 'Reject' THEN $4 ELSE NULL END,
           notes = CASE WHEN $5::text IS NOT NULL THEN COALESCE(notes, '') || ' ' || $5 ELSE notes END,
               updated_at = $6
             WHERE id = $7
     RETURNING id`,
    [
      decision,
      reviewStatus,
      rejectionReason ?? null,
      rejectionNotes ?? null,
      reviewNote ?? null,
      now,
      id,
    ],
  );
  return rows.length > 0;
}

// City is the most specific resolvable scope, then county, then statewide;
// "unclear" is the least specific — used to decide whether a new resolution
// should overwrite an existing one (never downgrade specificity silently).
const SCOPE_SPECIFICITY: Record<string, number> = { city: 3, county: 2, state: 1, unclear: 0 };

export interface RefreshFields {
  dr?: number | null;
  organic_traffic?: number | null;
  payment_amount?: string;
  payment_type?: string;
  submission_method?: string;
  contact_email?: string;
  link_evidence?: string;
  freshness_notes?: string;
  note?: string;
  /** Re-resolved location, if the refresh re-crawled the page. Overwrites the
   *  stored location only when provided — an "unclear" old record stays
   *  Needs Human Review until a refresh actually resolves it. */
  location?: {
    scope: string;
    city: string;
    county: string;
    state: string;
    label: string;
    confidence: string;
    evidence: string;
  };
}

export async function refreshOpportunity(
  id: string,
  fields: RefreshFields,
): Promise<boolean> {
  const sql = getSql();
  const now = Math.floor(Date.now() / 1000);
  const existing = await getOpportunityById(id);
  if (!existing) return false;

  // Only let the refreshed location overwrite the stored one when it is at
  // least as specific — an "unclear" refresh (e.g. a failed re-crawl) never
  // downgrades a previously confirmed city/county/statewide record.
  const existingScope = existing.resolved_location_scope || "unclear";
  const newScope = fields.location?.scope;
  const useNewLocation =
    !!fields.location && (SCOPE_SPECIFICITY[newScope ?? "unclear"] ?? 0) >= (SCOPE_SPECIFICITY[existingScope] ?? 0);

  const merged = {
    dr: fields.dr ?? existing.dr,
    organic_traffic: fields.organic_traffic ?? existing.organic_traffic,
    payment_amount: fields.payment_amount ?? existing.payment_amount ?? "Unknown",
    payment_type: fields.payment_type ?? existing.payment_type ?? "Unknown",
    submission_method: fields.submission_method ?? existing.submission_method ?? "Unknown",
    contact_email: fields.contact_email ?? existing.contact_email ?? "",
    link_evidence: fields.link_evidence ?? existing.link_evidence ?? "",
    freshness_notes: fields.freshness_notes ?? existing.freshness_notes ?? "",
    notes: fields.note ? `${existing.notes ?? ""} ${fields.note}`.trim() : existing.notes ?? "",
    city: useNewLocation ? fields.location!.city : existing.city ?? "",
    county: useNewLocation ? fields.location!.county : existing.county ?? "",
    state: useNewLocation ? fields.location!.state : existing.state,
    location: useNewLocation ? fields.location!.label : existing.location ?? "",
    resolved_location_scope: useNewLocation ? fields.location!.scope : existingScope,
    location_confidence: useNewLocation ? fields.location!.confidence : existing.location_confidence ?? "low",
    location_evidence: useNewLocation ? fields.location!.evidence : existing.location_evidence ?? "",
    human_review_trigger:
      (useNewLocation ? fields.location!.scope : existingScope) === "unclear"
        ? existing.human_review_trigger && existing.human_review_trigger !== "None"
          ? existing.human_review_trigger
          : "Location unclear"
        : existing.human_review_trigger,
  };

  const rows = await sql.query(
    `UPDATE opportunities SET
       dr = $1, organic_traffic = $2, payment_amount = $3, payment_type = $4,
       submission_method = $5, contact_email = $6, link_evidence = $7,
       freshness_notes = $8, notes = $9,
       city = $10, county = $11, state = $12, location = $13,
       resolved_location_scope = $14, location_confidence = $15, location_evidence = $16,
       human_review_trigger = $17,
       last_checked_at = $18, last_refreshed_at = $18, updated_at = $18
     WHERE id = $19
     RETURNING id`,
    [
      merged.dr,
      merged.organic_traffic,
      merged.payment_amount,
      merged.payment_type,
      merged.submission_method,
      merged.contact_email,
      merged.link_evidence,
      merged.freshness_notes,
      merged.notes,
      merged.city,
      merged.county,
      merged.state,
      merged.location,
      merged.resolved_location_scope,
      merged.location_confidence,
      merged.location_evidence,
      merged.human_review_trigger,
      now,
      id,
    ],
  );
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Firecrawl scrape cache
// ---------------------------------------------------------------------------

export interface CrawlCacheEntry {
  normalized_url: string;
  source_url: string;
  final_url: string | null;
  page_title: string | null;
  scraped_text: string | null;
  status: "success" | "failed";
  error: string | null;
  fetched_at: number;
}

export async function getCachedCrawls(
  normalizedUrls: string[],
): Promise<Map<string, CrawlCacheEntry>> {
  const map = new Map<string, CrawlCacheEntry>();
  if (normalizedUrls.length === 0) return map;
  const sql = getSql();
  const rows = (await sql.query(
    `SELECT * FROM crawl_cache WHERE normalized_url = ANY($1)`,
    [normalizedUrls],
  )) as Record<string, unknown>[];
  for (const row of rows) {
    map.set(String(row.normalized_url), {
      normalized_url: String(row.normalized_url),
      source_url: String(row.source_url ?? ""),
      final_url: row.final_url == null ? null : String(row.final_url),
      page_title: row.page_title == null ? null : String(row.page_title),
      scraped_text: row.scraped_text == null ? null : String(row.scraped_text),
      status: row.status === "success" ? "success" : "failed",
      error: row.error == null ? null : String(row.error),
      fetched_at: toNum(row.fetched_at) ?? 0,
    });
  }
  return map;
}

export async function getExistingInventoryDomains(
  domains: string[],
): Promise<Set<string>> {
  const out = new Set<string>();
  if (domains.length === 0) return out;
  const sql = getSql();
  const normalized = Array.from(
    new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean)),
  );
  if (normalized.length === 0) return out;
  const rows = (await sql.query(
    `SELECT LOWER(domain) AS domain FROM opportunities WHERE LOWER(domain) = ANY($1)`,
    [normalized],
  )) as Array<{ domain: string }>;
  for (const row of rows) {
    if (row.domain) out.add(row.domain);
  }
  return out;
}

export interface ExistingOpportunitySignal {
  domain: string;
  decision: string | null;
  city: string | null;
  county: string | null;
  state: string | null;
  metro: string | null;
  normalized_url: string | null;
}

export async function getExistingOpportunitySignals(
  domains: string[],
): Promise<ExistingOpportunitySignal[]> {
  if (domains.length === 0) return [];
  const sql = getSql();
  const normalized = Array.from(
    new Set(domains.map((d) => d.trim().toLowerCase()).filter(Boolean)),
  );
  if (normalized.length === 0) return [];
  try {
    const rows = (await sql.query(
      `SELECT
        LOWER(domain) AS domain,
        decision,
        city,
        county,
        state,
        metro,
        normalized_url
      FROM opportunities
      WHERE LOWER(domain) = ANY($1)`,
      [normalized],
    )) as Array<{
      domain: string;
      decision: string | null;
      city: string | null;
      county: string | null;
      state: string | null;
      metro: string | null;
      normalized_url: string | null;
    }>;
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/column\s+"metro"\s+does\s+not\s+exist/i.test(message)) {
      throw error;
    }

    const rows = (await sql.query(
      `SELECT
        LOWER(domain) AS domain,
        decision,
        city,
        county,
        state,
        NULL::text AS metro,
        normalized_url
      FROM opportunities
      WHERE LOWER(domain) = ANY($1)`,
      [normalized],
    )) as Array<{
      domain: string;
      decision: string | null;
      city: string | null;
      county: string | null;
      state: string | null;
      metro: string | null;
      normalized_url: string | null;
    }>;
    return rows;
  }
}

export async function upsertCrawlCache(entry: CrawlCacheEntry): Promise<void> {
  const sql = getSql();
  await sql.query(
    `INSERT INTO crawl_cache (
       normalized_url, source_url, final_url, page_title, scraped_text,
       status, error, fetched_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (normalized_url) DO UPDATE SET
       source_url = EXCLUDED.source_url,
       final_url = EXCLUDED.final_url,
       page_title = EXCLUDED.page_title,
       scraped_text = EXCLUDED.scraped_text,
       status = EXCLUDED.status,
       error = EXCLUDED.error,
       fetched_at = EXCLUDED.fetched_at`,
    [
      entry.normalized_url,
      entry.source_url,
      entry.final_url,
      entry.page_title,
      entry.scraped_text,
      entry.status,
      entry.error,
      entry.fetched_at,
    ],
  );
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function searchOpportunities(filters: SearchFilters): Promise<{
  opportunities: StoredOpportunity[];
  total: number;
}> {
  const sql = getSql();

  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  const sortBy = filters.sortBy || "created";
  const sortOrder = filters.sortOrder === "ASC" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (filters.city) {
    params.push(filters.city);
    conditions.push(`city = $${params.length}`);
  }
  if (filters.county) {
    params.push(filters.county);
    conditions.push(`county = $${params.length}`);
  }
  if (filters.state) {
    params.push(filters.state);
    conditions.push(`state = $${params.length}`);
  }
  if (filters.locationScope) {
    params.push(filters.locationScope);
    conditions.push(`resolved_location_scope = $${params.length}`);
  }
  if (filters.decision) {
    params.push(filters.decision);
    conditions.push(`decision = $${params.length}`);
  }
  if (filters.search) {
    const term = `%${filters.search}%`;
    params.push(term, term, term);
    conditions.push(
      `(domain ILIKE $${params.length - 2} OR opportunity_name ILIKE $${params.length - 1} OR contact_email ILIKE $${params.length})`,
    );
  }
  if (filters.paymentType) {
    params.push(filters.paymentType);
    conditions.push(`payment_type = $${params.length}`);
  }
  if (typeof filters.minDr === "number") {
    params.push(filters.minDr);
    conditions.push(`dr >= $${params.length}`);
  }
  if (typeof filters.maxDr === "number") {
    params.push(filters.maxDr);
    conditions.push(`dr <= $${params.length}`);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  // Whitelisted, never user-controlled — safe to interpolate.
  let sortColumn = "created_at";
  if (sortBy === "dr") sortColumn = "dr";
  else if (sortBy === "traffic") sortColumn = "organic_traffic";
  else if (sortBy === "score") sortColumn = "score";
  else if (sortBy === "payment_amount")
    sortColumn = "CAST(NULLIF(payment_amount, 'Unknown') AS NUMERIC)";

  const countRows = await sql.query(
    `SELECT COUNT(*)::int AS count FROM opportunities ${whereClause}`,
    params,
  );
  const total = (countRows[0]?.count as number) ?? 0;

  const limitIdx = params.length + 1;
  const offsetIdx = params.length + 2;
  const rows = await sql.query(
    `SELECT * FROM opportunities ${whereClause}
     ORDER BY ${sortColumn} ${sortOrder} NULLS LAST
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    [...params, limit, offset],
  );

  return { opportunities: rows.map(mapOpportunity), total };
}

export async function getOpportunityById(
  id: string,
): Promise<StoredOpportunity | null> {
  const sql = getSql();
  const rows = await sql.query(`SELECT * FROM opportunities WHERE id = $1`, [id]);
  return rows[0] ? mapOpportunity(rows[0]) : null;
}

export async function getResearchRuns(
  limit: number = 50,
  offset: number = 0,
): Promise<{ runs: ResearchRun[]; total: number }> {
  const sql = getSql();

  const countRows = await sql.query(
    `SELECT COUNT(*)::int AS count FROM research_runs`,
  );
  const total = (countRows[0]?.count as number) ?? 0;

  const rows = await sql.query(
    `SELECT * FROM research_runs ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return { runs: rows.map(mapRun), total };
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
  const sql = getSql();

  const totalRows = await sql.query(
    `SELECT COUNT(*)::int AS count FROM opportunities`,
  );
  const totalOpportunities = (totalRows[0]?.count as number) ?? 0;

  const cityCounts = (await sql.query(
    `SELECT city, COUNT(*)::int AS count FROM opportunities
     GROUP BY city ORDER BY count DESC LIMIT 10`,
  )) as { city: string; count: number }[];

  const stateCounts = (await sql.query(
    `SELECT state, COUNT(*)::int AS count FROM opportunities
     GROUP BY state ORDER BY count DESC LIMIT 10`,
  )) as { state: string; count: number }[];

  const decisions = (await sql.query(
    `SELECT decision, COUNT(*)::int AS count FROM opportunities GROUP BY decision`,
  )) as { decision: string; count: number }[];

  const decisionCounts = { Approve: 0, "Needs Human Review": 0, Reject: 0 };
  for (const d of decisions) {
    if (d.decision && d.decision in decisionCounts) {
      decisionCounts[d.decision as keyof typeof decisionCounts] = d.count;
    }
  }

  const avgRows = await sql.query(
    `SELECT AVG(score)::float AS avg FROM opportunities`,
  );
  const avgScore = toNum(avgRows[0]?.avg);

  return { totalOpportunities, cityCounts, stateCounts, decisionCounts, avgScore };
}

export async function getCitiesAndStates(state?: string): Promise<{
  cities: string[];
  states: string[];
}> {
  const sql = getSql();

  // Cities are only ever scoped to a single state — without one, "all
  // cities" would mix locations across states with no way to tell them
  // apart in a plain city dropdown, so we return none until a state is chosen.
  const cityRows = state
    ? await sql.query(
        `SELECT DISTINCT city FROM opportunities WHERE state = $1 AND city <> '' ORDER BY city`,
        [state],
      )
    : [];
  const stateRows = await sql.query(
    `SELECT DISTINCT state FROM opportunities ORDER BY state`,
  );

  return {
    cities: cityRows.map((r) => String(r.city)),
    states: stateRows.map((r) => String(r.state)),
  };
}

/**
 * No-op retained for API compatibility. SQLite needed periodic WAL
 * checkpoints; Neon Postgres manages its own storage, so there is nothing
 * to do here.
 */
export async function checkpointWAL(): Promise<void> {
  return;
}
