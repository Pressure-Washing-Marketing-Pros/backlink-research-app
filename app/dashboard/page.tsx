"use client";

import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import type { StoredOpportunity } from "@/lib/db";
import { toCsv } from "@/lib/csv";

interface Stats {
  totalOpportunities: number;
  cityCounts: { city: string; count: number }[];
  stateCounts: { state: string; count: number }[];
  decisionCounts: {
    Approve: number;
    "Needs Human Review": number;
    Reject: number;
  };
  avgScore: number | null;
}

interface SearchResponse {
  opportunities: StoredOpportunity[];
  total: number;
}

const DECISION_OPTIONS = ["Approve", "Needs Human Review", "Reject"] as const;

const SCOPE_OPTIONS = [
  { value: "", label: "All" },
  { value: "city", label: "City opportunities" },
  { value: "county", label: "County opportunities" },
  { value: "state", label: "Statewide opportunities" },
  { value: "unclear", label: "Location unclear" },
] as const;

function scopeBadgeClass(scope?: string): string {
  if (scope === "city") return "bg-blue-100 text-blue-800";
  if (scope === "county") return "bg-teal-100 text-teal-800";
  if (scope === "state") return "bg-indigo-100 text-indigo-800";
  return "bg-gray-100 text-gray-600";
}

function scopeLabel(scope?: string): string {
  if (scope === "city") return "City";
  if (scope === "county") return "County";
  if (scope === "state") return "Statewide";
  return "Unclear";
}

const EXPORT_COLUMNS = [
  "opportunity_name",
  "domain",
  "sponsorship_url",
  "sponsor_page_url",
  "location",
  "state",
  "county",
  "city",
  "resolved_location_scope",
  "source_query_scopes",
  "decision",
  "human_review_trigger",
  "payment_amount",
  "payment_type",
  "submission_method",
  "contact_email",
  "dr",
  "organic_traffic",
  "link_evidence",
  "current_sponsors_displayed",
  "freshness_notes",
  "last_checked_at",
  "last_refreshed_at",
  "notes",
];

function formatDate(epochSeconds?: number | null): string {
  if (!epochSeconds) return "Never";
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

function decisionBadgeClass(decision?: string): string {
  if (decision === "Approve") return "bg-green-100 text-green-800";
  if (decision === "Needs Human Review") return "bg-yellow-100 text-yellow-800";
  if (decision === "Reject") return "bg-red-100 text-red-800";
  return "bg-gray-100 text-gray-700";
}

function duplicateLabel(opp: StoredOpportunity): string | null {
  if (opp.duplicate_of) return "Possible duplicate";
  if (opp.notes?.includes("Skipped duplicate insert")) return "Skipped duplicate";
  if (opp.notes?.includes("Existing record updated")) return "Existing record updated";
  return null;
}

export default function Dashboard() {
  const [opportunities, setOpportunities] = useState<StoredOpportunity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [citiesAndStates, setCitiesAndStates] = useState<{
    cities: string[];
    states: string[];
  } | null>(null);
  const [savingDecisionId, setSavingDecisionId] = useState<string | null>(null);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [clearingAll, setClearingAll] = useState(false);

  // Search/filter state
  const [cityFilter, setCityFilter] = useState("");
  const [countyFilter, setCountyFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [scopeFilter, setScopeFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [paymentTypeFilter, setPaymentTypeFilter] = useState("");
  const [minDr, setMinDr] = useState("");
  const [maxDr, setMaxDr] = useState("");
  const [sortBy, setSortBy] = useState<"created" | "dr" | "traffic" | "score">("created");
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC");
  const [currentPage, setCurrentPage] = useState(0);
  const limit = 50;

  const buildParams = useCallback(
    (overrides: Record<string, string> = {}) => {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(currentPage * limit),
        sortBy,
        sortOrder,
      });
      if (cityFilter) params.append("city", cityFilter);
      if (countyFilter) params.append("county", countyFilter);
      if (stateFilter) params.append("state", stateFilter);
      if (scopeFilter) params.append("locationScope", scopeFilter);
      if (searchTerm) params.append("search", searchTerm);
      if (decisionFilter) params.append("decision", decisionFilter);
      if (paymentTypeFilter) params.append("paymentType", paymentTypeFilter);
      if (minDr) params.append("minDr", minDr);
      if (maxDr) params.append("maxDr", maxDr);
      for (const [k, v] of Object.entries(overrides)) params.set(k, v);
      return params;
    },
    [cityFilter, countyFilter, stateFilter, scopeFilter, searchTerm, decisionFilter, paymentTypeFilter, minDr, maxDr, sortBy, sortOrder, currentPage],
  );

  // Fetch stats on mount
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/research-runs?stats=true");
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        setStats(data);
      } catch (err) {
        console.error("Error fetching stats:", err);
      } finally {
        setStatsLoading(false);
      }
    };
    fetchStats();
  }, []);

  // City list depends on the selected state — "user selects a state, city
  // filter only shows locations from that state" (statewide entries have an
  // empty city and are still shown under the state filter itself).
  useEffect(() => {
    const fetchCitiesAndStates = async () => {
      try {
        const params = new URLSearchParams({ getCitiesAndStates: "true" });
        if (stateFilter) params.append("state", stateFilter);
        const response = await fetch(`/api/opportunities/search?${params}`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        setCitiesAndStates(data);
      } catch (err) {
        console.error("Error fetching cities and states:", err);
      }
    };
    fetchCitiesAndStates();
  }, [stateFilter]);

  // Fetch opportunities when filters/pagination changes
  useEffect(() => {
    const fetchOpportunities = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/opportunities/search?${buildParams()}`);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch opportunities: HTTP ${response.status} - ${errorText}`);
        }
        const data: SearchResponse = await response.json();
        setOpportunities(data.opportunities);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };
    fetchOpportunities();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cityFilter, countyFilter, stateFilter, scopeFilter, searchTerm, decisionFilter, paymentTypeFilter, minDr, maxDr, sortBy, sortOrder, currentPage]);

  const resetFilters = useCallback(() => {
    setCityFilter("");
    setCountyFilter("");
    setStateFilter("");
    setScopeFilter("");
    setSearchTerm("");
    setDecisionFilter("");
    setPaymentTypeFilter("");
    setMinDr("");
    setMaxDr("");
    setSortBy("created");
    setSortOrder("DESC");
    setCurrentPage(0);
  }, []);

  const handleReuseOpportunity = useCallback(async (id: string, clientName: string) => {
    try {
      await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "markUsed", clientName }),
      });
      alert("Opportunity marked as used!");
    } catch (err) {
      console.error("Error marking opportunity as used:", err);
      alert("Failed to mark opportunity as used");
    }
  }, []);

  const handleDecisionChange = useCallback(async (id: string, decision: string) => {
    setSavingDecisionId(id);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "setDecision", decision }),
      });
      if (!res.ok) throw new Error("Failed to update decision");
      setOpportunities((prev) =>
        prev.map((o) => (o.id === id ? { ...o, decision } : o)),
      );
    } catch (err) {
      alert(`Failed to update decision: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSavingDecisionId(null);
    }
  }, []);

  const handleRefresh = useCallback(async (id: string) => {
    setRefreshingId(id);
    setRefreshNote(null);
    try {
      const res = await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      setRefreshNote(data.note ?? "Refreshed.");
      const updated = await fetch(`/api/opportunities/${id}`);
      if (updated.ok) {
        const fresh: StoredOpportunity = await updated.json();
        setOpportunities((prev) => prev.map((o) => (o.id === id ? fresh : o)));
      }
    } catch (err) {
      alert(`Failed to refresh: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setRefreshingId(null);
    }
  }, []);

  const handleDelete = useCallback(async (id: string, label: string) => {
    if (!confirm(`Remove "${label}" from the inventory? This can't be undone.`)) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/opportunities/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Delete failed");
      }
      setOpportunities((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      alert(`Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  }, []);

  const handleClearInventory = useCallback(async () => {
    const typed = prompt(
      'This permanently deletes every opportunity in the inventory. Type "DELETE ALL" to confirm:',
    );
    if (typed !== "DELETE ALL") return;
    setClearingAll(true);
    try {
      const res = await fetch("/api/opportunities/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE ALL" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Clear failed");
      setOpportunities([]);
      alert(`Cleared ${data.deletedCount} opportunities from the inventory.`);
    } catch (err) {
      alert(`Failed to clear inventory: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setClearingAll(false);
    }
  }, []);

  const exportCsv = useCallback(async () => {
    setExporting(true);
    try {
      const params = buildParams({ limit: "1000", offset: "0" });
      const res = await fetch(`/api/opportunities/search?${params}`);
      if (!res.ok) throw new Error("Export fetch failed");
      const data: SearchResponse = await res.json();
      const rows = data.opportunities.map((o) => ({
        ...o,
        last_checked_at: formatDate(o.last_checked_at),
        last_refreshed_at: formatDate(o.last_refreshed_at),
      }));
      const csv = toCsv(EXPORT_COLUMNS, rows as unknown as Record<string, unknown>[]);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `sponsorship-inventory-${date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setExporting(false);
    }
  }, [buildParams]);

  const paymentTypes = useMemo(
    () => ["One-Time", "Annual", "Monthly", "Recurring", "Unknown"],
    [],
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Sponsorship Inventory</h1>
              <p className="text-gray-600 mt-1">Review, approve, reject, refresh, and export sponsorship opportunities</p>
            </div>
            <Link
              href="/"
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Back to Research
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar with Stats */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-sm p-6 sticky top-8">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Inventory Stats</h2>

              {statsLoading ? (
                <div className="animate-pulse space-y-3">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded"></div>
                </div>
              ) : stats ? (
                <div className="space-y-4">
                  <div>
                    <p className="text-sm text-gray-500">Total Opportunities</p>
                    <p className="text-2xl font-bold text-gray-900">{stats.totalOpportunities}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-900 mb-2">By Decision</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-green-600">✓ Approved</span>
                        <span className="font-medium">{stats.decisionCounts.Approve}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-yellow-600">⊙ Needs Human Review</span>
                        <span className="font-medium">{stats.decisionCounts["Needs Human Review"]}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-red-600">✕ Rejected</span>
                        <span className="font-medium">{stats.decisionCounts.Reject}</span>
                      </div>
                    </div>
                  </div>

                  {stats.avgScore !== null && (
                    <div>
                      <p className="text-sm text-gray-500">Average Score</p>
                      <p className="text-lg font-semibold text-gray-900">
                        {stats.avgScore.toFixed(2)}
                      </p>
                    </div>
                  )}

                  {stats.cityCounts.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">Top Locations</p>
                      <div className="space-y-1 text-xs">
                        {stats.cityCounts.slice(0, 5).map((item) => (
                          <div key={item.city} className="flex justify-between text-gray-600">
                            <span>{item.city || "Statewide"}</span>
                            <span className="font-medium">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {stats.stateCounts.length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-900 mb-2">Top States</p>
                      <div className="space-y-1 text-xs">
                        {stats.stateCounts.slice(0, 5).map((item) => (
                          <div key={item.state} className="flex justify-between text-gray-600">
                            <span>{item.state}</span>
                            <span className="font-medium">{item.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-lg shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Filters</h2>
                <div className="flex gap-2">
                  <button
                    onClick={exportCsv}
                    disabled={exporting}
                    className="px-3 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {exporting ? "Exporting…" : "Export CSV (current filters)"}
                  </button>
                  <button
                    onClick={handleClearInventory}
                    disabled={clearingAll}
                    className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50"
                  >
                    {clearingAll ? "Clearing…" : "Clear Inventory"}
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(0);
                    }}
                    placeholder="Domain, name, email..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <select
                    value={stateFilter}
                    onChange={(e) => {
                      setStateFilter(e.target.value);
                      setCityFilter("");
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All States</option>
                    {citiesAndStates?.states.map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City / Location {stateFilter ? `(${stateFilter})` : ""}
                  </label>
                  <select
                    value={cityFilter}
                    disabled={!stateFilter}
                    onChange={(e) => {
                      setCityFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                  >
                    <option value="">{stateFilter ? `All cities in ${stateFilter}` : "Select a state first"}</option>
                    {stateFilter && citiesAndStates?.cities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">County</label>
                  <input
                    type="text"
                    value={countyFilter}
                    onChange={(e) => {
                      setCountyFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    placeholder="e.g. Hillsborough County"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
                  <select
                    value={scopeFilter}
                    onChange={(e) => {
                      setScopeFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {SCOPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Decision Status</label>
                  <select
                    value={decisionFilter}
                    onChange={(e) => {
                      setDecisionFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All</option>
                    <option value="Approve">Approved</option>
                    <option value="Needs Human Review">Needs Human Review</option>
                    <option value="Reject">Rejected</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Payment Type</label>
                  <select
                    value={paymentTypeFilter}
                    onChange={(e) => {
                      setPaymentTypeFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Any</option>
                    {paymentTypes.map((pt) => (
                      <option key={pt} value={pt}>
                        {pt}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Min DR</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={minDr}
                    onChange={(e) => {
                      setMinDr(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max DR</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={maxDr}
                    onChange={(e) => {
                      setMaxDr(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sort By</label>
                  <select
                    value={sortBy}
                    onChange={(e) => {
                      setSortBy(e.target.value as typeof sortBy);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="created">Date Added</option>
                    <option value="dr">Domain Rating</option>
                    <option value="traffic">Organic Traffic (secondary)</option>
                    <option value="score">Score</option>
                  </select>
                </div>
              </div>

              <button
                onClick={resetFilters}
                className="px-3 py-2 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                Reset Filters
              </button>
            </div>

            {/* Results */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
                {error}
              </div>
            )}
            {refreshNote && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-blue-800 text-sm">
                {refreshNote}
              </div>
            )}

            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              {loading ? (
                <div className="p-8 text-center">
                  <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <p className="text-gray-600 mt-2">Loading opportunities...</p>
                </div>
              ) : opportunities.length === 0 ? (
                <div className="p-8 text-center text-gray-500">
                  No opportunities found. Try adjusting your filters.
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Opportunity
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Location
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Decision
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Flags
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            DR
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Traffic
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Package / Payment
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Last Checked
                          </th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {opportunities.map((opp) => (
                          <Fragment key={opp.id}>
                            <tr className="hover:bg-gray-50">
                              <td
                                className="px-4 py-4 text-sm text-gray-900 font-medium hover:text-blue-600 cursor-pointer"
                                onClick={() => setExpandedId(expandedId === opp.id ? null : opp.id)}
                              >
                                {opp.opportunity_name || opp.domain || "N/A"}
                                <div className="text-xs text-gray-500 font-normal">{opp.domain}</div>
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                <div>
                                  {opp.location || `${opp.city || ""}${opp.city && opp.state ? ", " : ""}${opp.state || ""}` || "Location unclear"}
                                </div>
                                <span
                                  className={`mt-1 inline-block px-2 py-0.5 rounded text-[11px] font-medium ${scopeBadgeClass(opp.resolved_location_scope)}`}
                                >
                                  {scopeLabel(opp.resolved_location_scope)}
                                </span>
                              </td>
                              <td className="px-4 py-4 text-sm">
                                <select
                                  value={opp.decision ?? ""}
                                  disabled={savingDecisionId === opp.id}
                                  onChange={(e) => handleDecisionChange(opp.id, e.target.value)}
                                  className={`px-2 py-1 rounded text-xs font-medium border-0 ${decisionBadgeClass(opp.decision)}`}
                                >
                                  {DECISION_OPTIONS.map((d) => (
                                    <option key={d} value={d}>
                                      {d}
                                    </option>
                                  ))}
                                </select>
                                {opp.human_review_trigger && opp.human_review_trigger !== "None" && (
                                  <div className="mt-1 text-[11px] text-gray-500 max-w-xs">
                                    {opp.human_review_trigger}
                                  </div>
                                )}
                              </td>
                              <td className="px-4 py-4 text-xs space-y-1">
                                {duplicateLabel(opp) && (
                                  <div className="inline-block px-2 py-0.5 rounded bg-orange-100 text-orange-800 font-medium">
                                    {duplicateLabel(opp)}
                                  </div>
                                )}
                                {opp.sensitive_category && (
                                  <div className="px-2 py-0.5 rounded bg-purple-100 text-purple-800 font-medium">
                                    Sensitive: {opp.sensitive_category}
                                  </div>
                                )}
                                {!duplicateLabel(opp) && !opp.sensitive_category && (
                                  <span className="text-gray-300">—</span>
                                )}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-900 font-semibold">
                                {typeof opp.dr === "number" ? opp.dr : "N/A"}
                              </td>
                              <td className="px-4 py-4 text-xs text-gray-400">
                                {typeof opp.organic_traffic === "number"
                                  ? opp.organic_traffic.toLocaleString()
                                  : "N/A"}
                              </td>
                              <td className="px-4 py-4 text-sm text-gray-600">
                                {opp.payment_amount || "Unknown"}
                                {opp.payment_type ? ` (${opp.payment_type})` : ""}
                              </td>
                              <td className="px-4 py-4 text-xs text-gray-500">
                                {formatDate(opp.last_checked_at)}
                              </td>
                              <td className="px-4 py-4 text-sm space-x-2 whitespace-nowrap">
                                <button
                                  onClick={() => handleRefresh(opp.id)}
                                  disabled={refreshingId === opp.id}
                                  className="text-blue-600 hover:text-blue-900 font-medium disabled:opacity-50"
                                >
                                  {refreshingId === opp.id ? "Refreshing…" : "Refresh"}
                                </button>
                                <button
                                  onClick={() => {
                                    const clientName = prompt("Client name:");
                                    if (clientName) handleReuseOpportunity(opp.id, clientName);
                                  }}
                                  className="text-gray-600 hover:text-gray-900 font-medium"
                                >
                                  Reuse
                                </button>
                                <button
                                  onClick={() => handleDelete(opp.id, opp.opportunity_name || opp.domain)}
                                  disabled={deletingId === opp.id}
                                  className="text-red-600 hover:text-red-900 font-medium disabled:opacity-50"
                                >
                                  {deletingId === opp.id ? "Deleting…" : "Delete"}
                                </button>
                              </td>
                            </tr>
                            {expandedId === opp.id && (
                              <tr className="bg-gray-50">
                                <td colSpan={9} className="px-6 py-4">
                                  <div className="grid gap-4 md:grid-cols-2 text-sm">
                                    <div className="space-y-2">
                                      <div>
                                        <p className="font-medium text-gray-900">Sponsorship URL</p>
                                        <a
                                          href={opp.sponsorship_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-blue-600 hover:underline break-all"
                                        >
                                          {opp.sponsorship_url}
                                        </a>
                                      </div>
                                      {opp.sponsor_page_url && (
                                        <div>
                                          <p className="font-medium text-gray-900">Sponsorship Page URL</p>
                                          <a
                                            href={opp.sponsor_page_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline break-all"
                                          >
                                            {opp.sponsor_page_url}
                                          </a>
                                        </div>
                                      )}
                                      <div>
                                        <p className="font-medium text-gray-900">Location Detail</p>
                                        <p className="text-gray-600">
                                          City: {opp.city || "—"} · County: {opp.county || "—"} · State: {opp.state || "—"}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">{opp.location_evidence || "No location evidence recorded."}</p>
                                        {opp.source_query_scopes && (
                                          <p className="text-xs text-gray-500">Found via: {opp.source_query_scopes} quer{opp.source_query_scopes.includes(",") ? "ies" : "y"}</p>
                                        )}
                                      </div>
                                      <div>
                                        <p className="font-medium text-gray-900">Current Sponsors Displayed</p>
                                        <p className="text-gray-600">{opp.current_sponsors_displayed || "Unknown"}</p>
                                      </div>
                                      <div>
                                        <p className="font-medium text-gray-900">Link Evidence</p>
                                        <p className="text-gray-600">{opp.link_evidence || "Unknown"}</p>
                                      </div>
                                      <div>
                                        <p className="font-medium text-gray-900">Submission Method</p>
                                        <p className="text-gray-600">{opp.submission_method || "Unknown"}</p>
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <div>
                                        <p className="font-medium text-gray-900">Contact</p>
                                        <p className="text-gray-600">
                                          {opp.contact_person || "N/A"} — {opp.contact_email || "N/A"}
                                        </p>
                                      </div>
                                      <div>
                                        <p className="font-medium text-gray-900">Site Quality Notes</p>
                                        <p className="text-gray-600">{opp.freshness_notes || "None"}</p>
                                      </div>
                                      <div>
                                        <p className="font-medium text-gray-900">Human Review Triggers</p>
                                        <p className="text-gray-600">{opp.human_review_trigger || "None"}</p>
                                      </div>
                                      {(duplicateLabel(opp) || opp.sensitive_category) && (
                                        <div>
                                          <p className="font-medium text-gray-900">Flags</p>
                                          <p className="text-gray-600">
                                            {[duplicateLabel(opp), opp.sensitive_category ? `Sensitive category: ${opp.sensitive_category}` : null]
                                              .filter(Boolean)
                                              .join(" · ")}
                                          </p>
                                        </div>
                                      )}
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <p className="font-medium text-gray-900">Last Checked</p>
                                          <p className="text-gray-600">{formatDate(opp.last_checked_at)}</p>
                                        </div>
                                        <div>
                                          <p className="font-medium text-gray-900">Last Refreshed</p>
                                          <p className="text-gray-600">{formatDate(opp.last_refreshed_at)}</p>
                                        </div>
                                      </div>
                                      {opp.notes && (
                                        <div>
                                          <p className="font-medium text-gray-900">Notes</p>
                                          <p className="text-gray-600">{opp.notes}</p>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      Showing {opportunities.length > 0 ? currentPage * limit + 1 : 0} to{" "}
                      {currentPage * limit + opportunities.length} results
                    </div>
                    <div className="space-x-2">
                      <button
                        onClick={() => setCurrentPage(Math.max(0, currentPage - 1))}
                        disabled={currentPage === 0}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={opportunities.length < limit}
                        className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
