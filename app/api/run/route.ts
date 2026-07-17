import { runResearch } from "@/lib/runResearch";
import { renderQueries, validateInputs } from "@/lib/queryBank";
import type { ClientInputs } from "@/lib/types";

// SAFEGUARD: This endpoint performs research only.
// It extracts and stores sponsorship opportunity information.
// It does NOT send emails, submit forms, make payments, or contact organizations.
// All contact information extracted is for HUMAN-AUTHORIZED outreach only.

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = "iad1";

const DEFAULT_RUN_TIMEOUT_MS = 295_000;

function runTimeoutMs(): number {
  const raw = Number(process.env.RUN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_RUN_TIMEOUT_MS;
}

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

  const inputs = validation.inputs;
  const queriesUsed = renderQueries(inputs).map((q) => q.query);
  const timeoutMs = runTimeoutMs();

  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const result = await Promise.race([
      runResearch(inputs),
      new Promise<"__timeout__">((resolve) => {
        timer = setTimeout(() => resolve("__timeout__"), timeoutMs);
      }),
    ]);

    if (result === "__timeout__") {
      return Response.json({
        summary: {
          client: inputs.client_business_name || "General sponsorship research",
          target_city: inputs.client_primary_city,
          target_state: inputs.client_state,
          run_date: new Date().toISOString(),
          total_candidates_reviewed: 0,
          approved_count: 0,
          review_count: 0,
          rejected_count: 0,
          queries_used: queriesUsed,
        },
        opportunities: [],
        warning:
          "Run timed out before full enrichment completed. Query count is complete, but opportunity results are incomplete for this run.",
      });
    }

    if ("status" in result && result.status === "Missing Required Inputs") {
      return Response.json(result, { status: 422 });
    }
    return Response.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
