"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import type { StoredOpportunity } from "@/lib/db";

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

  // Search/filter state
  const [cityFilter, setCityFilter] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [decisionFilter, setDecisionFilter] = useState("");
  const [sortBy, setSortBy] = useState<"created" | "dr" | "traffic" | "score">("created");
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC");
  const [currentPage, setCurrentPage] = useState(0);
  const limit = 50;

  // Fetch stats and cities/states on mount
  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await fetch("/api/research-runs?stats=true");
        if (response.ok) {
          const data = await response.json();
          setStats(data);
        }
      } catch (err) {
        console.error("Error fetching stats:", err);
      } finally {
        setStatsLoading(false);
      }
    };

    const fetchCitiesAndStates = async () => {
      try {
        const response = await fetch("/api/opportunities/search?getCitiesAndStates=true");
        if (response.ok) {
          const data = await response.json();
          setCitiesAndStates(data);
        }
      } catch (err) {
        console.error("Error fetching cities and states:", err);
      }
    };

    fetchStats();
    fetchCitiesAndStates();
  }, []);

  // Fetch opportunities when filters/pagination changes
  const offset = currentPage * limit;
  useEffect(() => {
    const fetchOpportunities = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          limit: String(limit),
          offset: String(offset),
          sortBy,
          sortOrder,
        });

        if (cityFilter) params.append("city", cityFilter);
        if (stateFilter) params.append("state", stateFilter);
        if (searchTerm) params.append("search", searchTerm);
        if (decisionFilter) params.append("decision", decisionFilter);

        const response = await fetch(`/api/opportunities/search?${params}`);

        if (!response.ok) {
          throw new Error("Failed to fetch opportunities");
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
  }, [cityFilter, stateFilter, searchTerm, decisionFilter, sortBy, sortOrder, offset]);

  const resetFilters = useCallback(() => {
    setCityFilter("");
    setStateFilter("");
    setSearchTerm("");
    setDecisionFilter("");
    setSortBy("created");
    setSortOrder("DESC");
    setCurrentPage(0);
  }, []);

  const handleReuseOpportunity = useCallback(async (id: string, clientName: string) => {
    try {
      await fetch(`/api/opportunities/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "markUsed",
          clientName,
        }),
      });
      alert("Opportunity marked as used!");
    } catch (err) {
      console.error("Error marking opportunity as used:", err);
      alert("Failed to mark opportunity as used");
    }
  }, []);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Sponsorship Inventory</h1>
              <p className="text-gray-600 mt-1">View and search saved sponsorship opportunities</p>
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
                        <span className="text-yellow-600">⊙ Review</span>
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
                      <p className="text-sm font-medium text-gray-900 mb-2">Top Cities</p>
                      <div className="space-y-1 text-xs">
                        {stats.cityCounts.slice(0, 5).map((item) => (
                          <div key={item.city} className="flex justify-between text-gray-600">
                            <span>{item.city}</span>
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
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Filters</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Search
                  </label>
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
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    City
                  </label>
                  <select
                    value={cityFilter}
                    onChange={(e) => {
                      setCityFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Cities</option>
                    {citiesAndStates?.cities.map((city) => (
                      <option key={city} value={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    State
                  </label>
                  <select
                    value={stateFilter}
                    onChange={(e) => {
                      setStateFilter(e.target.value);
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
                    Decision
                  </label>
                  <select
                    value={decisionFilter}
                    onChange={(e) => {
                      setDecisionFilter(e.target.value);
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">All Decisions</option>
                    <option value="Approve">Approved</option>
                    <option value="Needs Human Review">Needs Review</option>
                    <option value="Reject">Rejected</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Sort By
                  </label>
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
                    <option value="traffic">Organic Traffic</option>
                    <option value="score">Score</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Order
                  </label>
                  <select
                    value={sortOrder}
                    onChange={(e) => {
                      setSortOrder(e.target.value as "ASC" | "DESC");
                      setCurrentPage(0);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="DESC">Descending</option>
                    <option value="ASC">Ascending</option>
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
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Domain
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Location
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Decision
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            DR
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Traffic
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Method
                          </th>
                          <th className="px-6 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {opportunities.map((opp, idx) => (
                          <tbody key={opp.id ?? idx}>
                            <tr className="hover:bg-gray-50 cursor-pointer">
                              <td
                                className="px-6 py-4 text-sm text-gray-900 font-medium hover:text-blue-600"
                                onClick={() =>
                                  setExpandedId(expandedId === opp.id ? null : opp.id)
                                }
                              >
                                {opp.Domain || "N/A"}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {opp.City}, {opp.State}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <span
                                  className={`px-2 py-1 rounded text-xs font-medium ${
                                    opp.Decision === "Approve"
                                      ? "bg-green-100 text-green-800"
                                      : opp.Decision === "Needs Human Review"
                                        ? "bg-yellow-100 text-yellow-800"
                                        : "bg-red-100 text-red-800"
                                  }`}
                                >
                                  {opp.Decision}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {typeof opp.DR === "number" ? opp.DR : "N/A"}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {typeof opp.Traffic === "number"
                                  ? opp.Traffic.toLocaleString()
                                  : "N/A"}
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-600">
                                {opp.submission_method || "N/A"}
                              </td>
                              <td className="px-6 py-4 text-sm">
                                <button
                                  onClick={() => {
                                    const clientName = prompt("Client name:");
                                    if (clientName) {
                                      handleReuseOpportunity(opp.id, clientName);
                                    }
                                  }}
                                  className="text-blue-600 hover:text-blue-900 font-medium"
                                >
                                  Reuse
                                </button>
                              </td>
                            </tr>
                            {expandedId === opp.id && (
                              <tr className="bg-gray-50">
                                <td colSpan={7} className="px-6 py-4">
                                  <div className="space-y-2 text-sm">
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
                                    <div>
                                      <p className="font-medium text-gray-900">Contact</p>
                                      <p className="text-gray-600">
                                        {opp.contact_person || "N/A"} - {opp.contact_email || "N/A"}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="font-medium text-gray-900">Link Status</p>
                                      <p className="text-gray-600">
                                        {opp.link_opportunity_status || "Unknown"}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="font-medium text-gray-900">Payment</p>
                                      <p className="text-gray-600">
                                        {opp.payment_amount || "N/A"} ({opp.payment_type || "Unknown"})
                                      </p>
                                    </div>
                                    {opp.notes && (
                                      <div>
                                        <p className="font-medium text-gray-900">Notes</p>
                                        <p className="text-gray-600">{opp.notes}</p>
                                      </div>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </tbody>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
                    <div className="text-sm text-gray-600">
                      Showing {opportunities.length > 0 ? offset + 1 : 0} to{" "}
                      {Math.min(offset + limit, 999)} results
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
