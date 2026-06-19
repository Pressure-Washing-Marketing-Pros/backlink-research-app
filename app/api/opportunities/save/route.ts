import { saveOpportunitiesToDb } from "@/lib/db";
import type { RunResult } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      runResult: RunResult;
      clientName: string;
    };

    if (!body.runResult || !body.clientName) {
      return Response.json(
        { error: "Missing runResult or clientName" },
        { status: 400 },
      );
    }

    const result = await saveOpportunitiesToDb(body.runResult, body.clientName);

    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error saving opportunities:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
