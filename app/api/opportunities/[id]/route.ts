import { getOpportunityById, markOpportunityAsUsed } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const opportunity = await getOpportunityById(id);

    if (!opportunity) {
      return Response.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }

    return Response.json(opportunity);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching opportunity:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json() as {
      action?: string;
      clientName?: string;
    };

    if (body.action === "markUsed") {
      if (!body.clientName) {
        return Response.json(
          { error: "Missing clientName" },
          { status: 400 },
        );
      }

      const success = await markOpportunityAsUsed(id, body.clientName);

      if (!success) {
        return Response.json(
          { error: "Opportunity not found" },
          { status: 404 },
        );
      }

      return Response.json({ success: true });
    }

    return Response.json(
      { error: "Unknown action" },
      { status: 400 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error updating opportunity:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
