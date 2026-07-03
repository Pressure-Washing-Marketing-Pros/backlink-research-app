import {
  searchOpportunities,
  getCitiesAndStates,
  checkpointWAL,
} from "@/lib/db";

export const runtime = "nodejs";

let lastCheckpoint = Date.now();

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const city = url.searchParams.get("city") || undefined;
    const county = url.searchParams.get("county") || undefined;
    const state = url.searchParams.get("state") || undefined;
    const locationScope = url.searchParams.get("locationScope") || undefined;
    const search = url.searchParams.get("search") || undefined;
    const decision = url.searchParams.get("decision") || undefined;
    const paymentType = url.searchParams.get("paymentType") || undefined;
    const minDrParam = url.searchParams.get("minDr");
    const maxDrParam = url.searchParams.get("maxDr");
    const minDr = minDrParam ? Number(minDrParam) : undefined;
    const maxDr = maxDrParam ? Number(maxDrParam) : undefined;
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");
    const sortBy = (url.searchParams.get("sortBy") || "created") as "created" | "dr" | "traffic" | "score";
    const sortOrder = (url.searchParams.get("sortOrder") || "DESC") as "ASC" | "DESC";

    // Handle special case: get cities and states (optionally scoped to a state,
    // so the city dropdown can be filtered to that state's locations)
    if (url.searchParams.get("getCitiesAndStates") === "true") {
      const citiesAndStates = await getCitiesAndStates(state);
      return Response.json(citiesAndStates);
    }

    const result = await searchOpportunities({
      city,
      county,
      state,
      locationScope,
      search,
      decision,
      paymentType,
      minDr,
      maxDr,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    // Checkpoint WAL every 30 seconds to prevent bloat
    if (Date.now() - lastCheckpoint > 30000) {
      lastCheckpoint = Date.now();
      checkpointWAL().catch((err) => console.warn("Checkpoint failed:", err));
    }

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error searching opportunities:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
