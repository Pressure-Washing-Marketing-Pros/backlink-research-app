import "server-only";
import { renderQueries, validateInputs } from "@/lib/queryBank";
import type { ClientInputs } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  let body: Partial<ClientInputs>;
  try {
    body = (await request.json()) as Partial<ClientInputs>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validation = validateInputs(body);
  if (!validation.ok) {
    return Response.json(
      { status: "Missing Required Inputs", missing_fields: validation.missing },
      { status: 422 },
    );
  }

  const queries = renderQueries(validation.inputs).map((q) => ({
    class: q.class,
    class_name: q.class_name,
    query: q.query,
    target_city: q.target_city,
    target_state: q.target_state,
  }));

  return Response.json({ queries });
}
