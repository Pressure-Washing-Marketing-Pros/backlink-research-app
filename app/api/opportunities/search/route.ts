import {
  searchOpportunities,
  getCitiesAndStates,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = url.searchParams.get("city") || undefined;
    const state = url.searchParams.get("state") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const decision = url.searchParams.get("decision") || undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const sortBy = (url.searchParams.get("sortBy") || "created") as "created" | "dr" | "traffic" | "score";
    const sortOrder = (url.searchParams.get("sortOrder") || "DESC") as "ASC" | "DESC";

    // Handle special case: get cities and states
    if (url.searchParams.get("getCitiesAndStates") === "true") {
      const citiesAndStates = await getCitiesAndStates();
      return Response.json(citiesAndStates);
    }

    const result = await searchOpportunities({
      city,
      state,
      search,
      decision,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error searching opportunities:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
