import { getResearchRuns, getInventoryStats } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get("limit") || "50");
    const offset = parseInt(url.searchParams.get("offset") || "0");

    // Handle special case: get inventory stats
    if (url.searchParams.get("stats") === "true") {
      const stats = await getInventoryStats();
      return Response.json(stats);
    }

    const result = await getResearchRuns(limit, offset);

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching research runs:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
