import { clearInventory } from "@/lib/db";

export const runtime = "nodejs";

// Wipes every opportunity in the inventory. Requires an explicit
// confirmation phrase in the body — irreversible, so no accidental client
// bug or retry should be able to trigger it silently.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: string };
    if (body.confirm !== "DELETE ALL") {
      return Response.json(
        { error: 'Missing confirmation. Send { "confirm": "DELETE ALL" } to proceed.' },
        { status: 400 },
      );
    }

    const { deletedCount } = await clearInventory();
    return Response.json({ success: true, deletedCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error clearing inventory:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
