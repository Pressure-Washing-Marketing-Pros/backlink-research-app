import { runResearch } from "@/lib/runResearch";
import type { ClientInputs } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let body: Partial<ClientInputs>;
  try {
    body = (await request.json()) as Partial<ClientInputs>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await runResearch(body);
    if ("status" in result && result.status === "Missing Required Inputs") {
      return Response.json(result, { status: 422 });
    }
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
