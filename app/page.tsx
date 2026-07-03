"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OPPORTUNITY_COLUMNS } from "@/lib/decision";
import { toCsv } from "@/lib/csv";
import type {
  ClientInputs,
  Decision,
  Opportunity,
  RenderedQuery,
  RunResult,
  ValidationError,
} from "@/lib/types";

// Sponsorship research targets a location (city/state/county/metro), not a
// client campaign — business/niche/landing-page fields have been removed
// from the form. They're still accepted by the API for backward
// compatibility but are no longer required or collected here.
type FormState = {
  client_primary_city: string;
  client_state: string;
  state_abbrev: string;
  county: string;
  metro: string;
  maximum_approved_budget: string;
  budget_exceptions_allowed: "Yes" | "No";
};

const INITIAL: FormState = {
  client_primary_city: "",
  client_state: "",
  state_abbrev: "",
  county: "",
  metro: "",
  maximum_approved_budget: "",
  budget_exceptions_allowed: "No",
};

const DECISION_FILTERS: ("All" | Decision)[] = [
  "All",
  "Approve",
  "Needs Human Review",
  "Reject",
];

function toClientInputs(form: FormState): Partial<ClientInputs> {
  return {
    client_primary_city: form.client_primary_city,
    client_state: form.client_state,
    maximum_approved_budget: Number(form.maximum_approved_budget) || 0,
    budget_exceptions_allowed: form.budget_exceptions_allowed,
    state_abbrev: form.state_abbrev || undefined,
    county: form.county || undefined,
    metro: form.metro || undefined,
  };
}

export default function Home() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [queryPreview, setQueryPreview] = useState<RenderedQuery[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [editedRows, setEditedRows] = useState<Record<string, Partial<Opportunity>>>({});
  const [decisionFilter, setDecisionFilter] = useState<"All" | Decision>("All");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<{ ready: boolean; missing: string[]; message: string } | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [savingToInventory, setSavingToInventory] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  async function parseApiResponse<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!text) return {} as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      // Some server/runtime failures return plain text; normalize it to an
      // object shape so callers can surface a useful error message.
      return { error: text } as T;
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMissing(null);
    setResult(null);
    setEditedRows({});
    try {
      const res = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toClientInputs(form)),
      });
      const data = await parseApiResponse<RunResult | ValidationError | { error: string }>(res);
      if ("status" in data && data.status === "Missing Required Inputs") {
        setMissing(data.missing_fields);
        return;
      }
      if ("error" in data) {
        setError(data.error);
        return;
      }
      setResult(data as RunResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function getOpportunityKey(o: Opportunity): string {
    return `${o.Domain}::${o["Sponsorship URL"] || o["Opportunity Name"]}`;
  }

  const mergeOpportunity = useCallback(
    (o: Opportunity): Opportunity => {
      const key = getOpportunityKey(o);
      const updates = editedRows[key];
      return updates ? ({ ...o, ...updates } as Opportunity) : o;
    },
    [editedRows],
  );

  function handleRowChange(key: string, changes: Partial<Opportunity>) {
    setEditedRows((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? {}), ...changes },
    }));
  }

  async function previewQueries() {
    setPreviewLoading(true);
    setPreviewError(null);
    setQueryPreview(null);
    try {
      const res = await fetch("/api/queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toClientInputs(form)),
      });
      const data = await parseApiResponse<{ queries?: RenderedQuery[]; error?: string; missing_fields?: string[] }>(res);
      if (!res.ok) {
        if (data?.missing_fields) {
          setPreviewError("Missing required inputs for query preview.");
        } else {
          setPreviewError(data?.error ?? "Unable to preview queries.");
        }
        return;
      }
      setQueryPreview(data.queries ?? []);
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setPreviewLoading(false);
    }
  }

  const mergedOpportunities = useMemo<Opportunity[]>(() => {
    if (!result) return [];
    return result.opportunities.map(mergeOpportunity);
  }, [result, mergeOpportunity]);

  const filtered = useMemo<Opportunity[]>(() => {
    const list = mergedOpportunities;
    const q = search.trim().toLowerCase();
    return list.filter((o) => {
      if (decisionFilter !== "All" && o.Decision !== decisionFilter) return false;
      if (!q) return true;
      return (
        o.Domain.toLowerCase().includes(q) ||
        o["Opportunity Name"].toLowerCase().includes(q) ||
        o["Search Query Used"].toLowerCase().includes(q)
      );
    });
  }, [mergedOpportunities, decisionFilter, search]);

  function exportCsv() {
    if (!result) return;
    const rows = mergedOpportunities.filter((o) => o.Decision !== "Reject");
    const csv = toCsv(OPPORTUNITY_COLUMNS as string[], rows as unknown as Record<string, unknown>[]);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `${safe(result.summary.client) || "client"}-sponsorship-research-${date}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function saveToInventory() {
    if (!result) return;
    setSavingToInventory(true);
    setSaveSuccess(null);
    try {
      const res = await fetch("/api/opportunities/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runResult: result,
          clientName: result.summary.client,
        }),
      });
      const data = await parseApiResponse<{ saved_count?: number; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data.error || "Failed to save opportunities");
      }
      setSaveSuccess(`Successfully saved ${data.saved_count ?? 0} opportunities to inventory!`);
      setShowSaveDialog(false);
    } catch (err) {
      alert(`Error saving to inventory: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingToInventory(false);
    }
  }

  useEffect(() => {
    async function loadStatus() {
      try {
        const res = await fetch("/api/status");
        if (!res.ok) throw new Error("Unable to load status");
        const json = await parseApiResponse<{ ready: boolean; missing: string[]; message: string }>(res);
        setStatus(json);
      } catch (err) {
        setStatus({ ready: false, missing: [], message: err instanceof Error ? err.message : "Unknown error" });
      } finally {
        setStatusLoading(false);
      }
    }
    loadStatus();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-slate-50">
      <main className="mx-auto max-w-7xl px-6 py-10">
        <header className="mb-10 border-b border-slate-200 pb-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <img
                src="/pwmarketing-logo.png"
                alt="PW Marketing Pros"
                className="h-16 w-auto"
              />
              <div>
                <h1 className="text-3xl font-bold text-slate-900">
                  Sponsorship Researcher
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Find and qualify local sponsorship opportunities by location — SERP discovery + DR lookup + sponsorship-page review.
                </p>
              </div>
            </div>
            <a
              href="/dashboard"
              className="rounded-md bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
            >
              View Sponsorship Inventory
            </a>
          </div>
        </header>

        <section className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Research engine status</h2>
              <p className="text-sm text-slate-600">
                {statusLoading ? "Checking environment..." : status?.message}
              </p>
            </div>
            {!statusLoading && (
              <span
                className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                  status?.ready
                    ? "bg-emerald-100 text-emerald-800"
                    : "bg-red-100 text-red-800"
                }`}
              >
                {status?.ready ? "Ready" : "Needs configuration"}
              </span>
            )}
          </div>
          {!statusLoading && (status?.missing?.length ?? 0) > 0 && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              <p className="font-medium">Missing env vars:</p>
              <ul className="mt-1 list-inside list-disc">
                {status?.missing?.map((name) => (
                  <li key={name}>
                    <code>{name}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <form
          onSubmit={onSubmit}
          className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm md:grid-cols-2"
        >
          <Field label="Target city *">
            <input
              required
              value={form.client_primary_city}
              onChange={(e) => update("client_primary_city", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Target state *">
            <input
              required
              value={form.client_state}
              onChange={(e) => update("client_state", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="State abbreviation (e.g. NC)">
            <input
              value={form.state_abbrev}
              onChange={(e) => update("state_abbrev", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="County">
            <input
              value={form.county}
              onChange={(e) => update("county", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Metro">
            <input
              value={form.metro}
              onChange={(e) => update("metro", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Likely budget ceiling ($) *">
            <input
              required
              type="number"
              min="0"
              value={form.maximum_approved_budget}
              onChange={(e) => update("maximum_approved_budget", e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Budget exceptions allowed *">
            <select
              value={form.budget_exceptions_allowed}
              onChange={(e) =>
                update("budget_exceptions_allowed", e.target.value as "Yes" | "No")
              }
              className={inputClass}
            >
              <option value="No">No</option>
              <option value="Yes">Yes</option>
            </select>
          </Field>

          <div className="md:col-span-2 grid gap-3 lg:grid-cols-[auto_1fr] lg:items-center">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-blue-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Running…" : "Run research"}
              </button>
              <button
                type="button"
                disabled={previewLoading}
                onClick={previewQueries}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewLoading ? "Previewing…" : "Preview queries"}
              </button>
            </div>
            {loading && (
              <span className="text-sm text-slate-600">
                This can take a few minutes — running 33 queries × ~30 results, then Ahrefs lookups.
              </span>
            )}
          </div>
        </form>

        {previewError && (
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-medium">Query preview error:</p>
            <p className="mt-1 font-mono">{previewError}</p>
          </div>
        )}

        {queryPreview && (
          <section className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Generated query bank</h2>
                <p className="mt-1 text-sm text-slate-600">
                  These are the exact queries that will be used for this research run.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-900">
                  {queryPreview.length} queries
                </div>
                {result && (
                  <a
                    href="#results-section"
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    ↓ Back to Results
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setQueryPreview(null)}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                >
                  Close Preview
                </button>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2">Class</th>
                    <th className="px-3 py-2">Scope</th>
                    <th className="px-3 py-2">Target</th>
                    <th className="px-3 py-2">Query</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {queryPreview.map((q, index) => (
                    <tr key={`${q.query}-${index}`}>
                      <td className="px-3 py-2 font-mono text-xs">{q.class}</td>
                      <td className="px-3 py-2 capitalize">{q.scope}</td>
                      <td className="px-3 py-2">
                        {q.scope === "state" ? q.target_state : `${q.target_city}, ${q.target_state}`}
                      </td>
                      <td className="px-3 py-2 break-words">{q.query}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {missing && (
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-medium">Missing required inputs:</p>
            <ul className="mt-1 list-inside list-disc">
              {missing.map((f) => (
                <li key={f}>
                  <code>{f}</code>
                </li>
              ))}
            </ul>
          </div>
        )}

        {error && (
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <p className="font-medium">Error:</p>
            <p className="mt-1 font-mono">{error}</p>
          </div>
        )}

        {result && (
          <section id="results-section" className="mt-10">
            <SummaryPanel result={result} mergedOpportunities={mergedOpportunities} />

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex gap-1">
                {DECISION_FILTERS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setDecisionFilter(f)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      decisionFilter === f
                        ? "bg-blue-900 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by domain, title, or query"
                className={`${inputClass} max-w-sm`}
              />
              <button
                onClick={() => setShowSaveDialog(true)}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
              >
                Save to Inventory
              </button>
              <button
                onClick={exportCsv}
                className="ml-2 rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Export non-rejected to CSV
              </button>
            </div>

            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    {[
                      "Score",
                      "Decision",
                      "Opportunity",
                      "Domain",
                      "Location",
                      "Relevance",
                      "DR",
                      "Traffic",
                      "HTTPS",
                      "Trigger",
                      "Query",
                    ].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-3 py-2 text-left font-semibold text-zinc-600 dark:text-zinc-300"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {filtered.map((o, i) => {
                    const rowKey = getOpportunityKey(o);
                    return (
                        <tr key={`${rowKey}-${i}`}>
                          <td className="px-3 py-2 font-mono tabular-nums">{o.Score}</td>
                          <td className="px-3 py-2">
                            <select
                              value={o.Decision}
                              onChange={(e) =>
                                handleRowChange(rowKey, {
                                  Decision: e.target.value as Decision,
                                  "Human Review Trigger":
                                    e.target.value === "Reject" ? "Manual reject" : o["Human Review Trigger"],
                                })
                              }
                              className={`rounded px-2 py-1 text-xs font-medium border-0 ${DECISION_BADGE_STYLES[o.Decision]}`}
                            >
                              {ALL_DECISIONS.map((d) => (
                                <option key={d} value={d}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <a
                              href={o["Sponsorship URL"]}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline dark:text-blue-400"
                            >
                              {o["Opportunity Name"] || o.Domain}
                            </a>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">{o.Domain}</td>
                          <td className="px-3 py-2 text-xs">
                            {o.Location}
                            <span className="ml-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] uppercase text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                              {o["Resolved Location Scope"]}
                            </span>
                          </td>
                          <td className="px-3 py-2">{o["Local Relevance Rating"]}</td>
                          <td className="px-3 py-2 tabular-nums">{String(o.DR)}</td>
                          <td className="px-3 py-2 tabular-nums">{String(o.Traffic)}</td>
                          <td className="px-3 py-2">{o.HTTPS}</td>
                          <td className="px-3 py-2 text-xs text-zinc-500">{o["Human Review Trigger"]}</td>
                          <td className="px-3 py-2 text-xs text-zinc-500">{o["Search Query Used"]}</td>
                        </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-8 text-center text-zinc-500">
                        No rows match the current filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {saveSuccess && (
              <div className="mt-4 rounded-md border border-green-300 bg-green-50 p-4 text-sm text-green-900">
                <p className="font-medium">✓ {saveSuccess}</p>
                <p className="mt-1 text-xs text-green-700">
                 Visit the <a href="/dashboard" className="font-medium hover:underline">inventory dashboard</a> to search and reuse these opportunities.
                </p>
              </div>
            )}

            {showSaveDialog && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="rounded-lg bg-white shadow-xl max-w-md w-full mx-4">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-lg font-semibold text-slate-900">Save to Inventory</h3>
                  </div>
                  <div className="px-6 py-4 space-y-3">
                    <p className="text-sm text-slate-600">
                      This will save <strong>{mergedOpportunities.filter((o) => o.Decision !== "Reject").length}</strong> approved and review opportunities to your inventory for future reuse.
                    </p>
                    <div className="bg-blue-50 rounded-md p-3 text-xs text-blue-900">
                      <p className="font-medium mb-1">Opportunities will be saved as:</p>
                      <ul className="list-disc list-inside space-y-1">
                        <li>{mergedOpportunities.filter((o) => o.Decision === "Approve").length} Approved</li>
                        <li>{mergedOpportunities.filter((o) => o.Decision === "Needs Human Review").length} Needs Review</li>
                      </ul>
                    </div>
                  </div>
                  <div className="border-t border-slate-200 flex gap-3 px-6 py-4">
                    <button
                      onClick={() => setShowSaveDialog(false)}
                      className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={saveToInventory}
                      disabled={savingToInventory}
                      className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {savingToInventory ? "Saving..." : "Save to Inventory"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

const DECISION_BADGE_STYLES: Record<Decision, string> = {
  Approve: "bg-emerald-100 text-emerald-800",
  "Needs Human Review": "bg-amber-100 text-amber-800",
  Reject: "bg-red-100 text-red-800",
};

const ALL_DECISIONS: Decision[] = ["Approve", "Needs Human Review", "Reject"];

function SummaryPanel({
  result,
  mergedOpportunities,
}: {
  result: RunResult;
  mergedOpportunities: Opportunity[];
}) {
  const { summary } = result;
  const approvedCount = mergedOpportunities.filter((o) => o.Decision === "Approve").length;
  const reviewCount = mergedOpportunities.filter((o) => o.Decision === "Needs Human Review").length;
  const rejectedCount = mergedOpportunities.filter((o) => o.Decision === "Reject").length;

  return (
    <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-blue-50 to-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">Run summary</h2>
      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
        <div>
          <dt className="text-slate-600">Client</dt>
          <dd className="text-slate-900">{summary.client}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Target</dt>
          <dd className="text-slate-900">{summary.target_city}, {summary.target_state}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Run date</dt>
          <dd className="text-slate-900">{new Date(summary.run_date).toLocaleString()}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Queries used</dt>
          <dd className="text-slate-900">{summary.queries_used.length}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Total candidates</dt>
          <dd className="font-mono text-slate-900">{mergedOpportunities.length}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Approved</dt>
          <dd className="font-mono text-slate-900">{approvedCount}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Needs review</dt>
          <dd className="font-mono text-slate-900">{reviewCount}</dd>
        </div>
        <div>
          <dt className="text-slate-600">Rejected</dt>
          <dd className="font-mono">{rejectedCount}</dd>
        </div>
      </dl>
    </div>
  );
}
