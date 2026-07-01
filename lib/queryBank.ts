import fs from "node:fs";
import path from "node:path";
import { parseCsv } from "@/lib/csv";
import type { ClientInputs, QueryBankRow, RenderedQuery } from "@/lib/types";

const QUERY_BANK_PATH = path.join(
  process.cwd(),
  "skills",
  "sponsorship",
  "query-bank.csv",
);

let cached: QueryBankRow[] | null = null;

export function loadQueryBank(): QueryBankRow[] {
  if (cached) return cached;
  const text = fs.readFileSync(QUERY_BANK_PATH, "utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("Query bank is empty");
  const [header, ...data] = rows;
  const idx = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`Query bank missing column: ${name}`);
    return i;
  };
  const cls = idx("class");
  const cname = idx("class_name");
  const q = idx("query");
  cached = data.map((r) => {
    const c = Number(r[cls]);
    if (c !== 1 && c !== 2 && c !== 3 && c !== 4) {
      throw new Error(`Invalid class ${r[cls]} in query bank`);
    }
    return {
      class: c as 1 | 2 | 3 | 4,
      class_name: r[cname],
      query: r[q],
    };
  });
  return cached;
}

function substitute(
  template: string,
  vars: Record<string, string>,
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`[${key}]`).join(value);
  }
  return out;
}

export function renderQueries(inputs: ClientInputs): RenderedQuery[] {
  const bank = loadQueryBank();
  const useClass4 =
    (inputs.nearby_cities_allowed === "Yes") &&
    (!!inputs.metro ||
      !!inputs.county ||
      !!(inputs.service_area_cities && inputs.service_area_cities.length > 0));

  const baseVars: Record<string, string> = {
    CITY: inputs.client_primary_city,
    STATE: inputs.client_state,
    "STATE ABBREV": inputs.state_abbrev ?? "",
    COUNTY: inputs.county ?? "",
    METRO: inputs.metro ?? "",
  };

  const rendered: RenderedQuery[] = [];

  for (const row of bank) {
    if (row.class === 4) {
      if (!useClass4) continue;
      const needsNearbyCity = row.query.includes("[NEARBY CITY]");
      const needsCounty = row.query.includes("[COUNTY]");
      const needsMetro = row.query.includes("[METRO]");

      if (needsNearbyCity) {
        const cities = inputs.service_area_cities ?? [];
        for (const city of cities) {
          const vars = { ...baseVars, "NEARBY CITY": city };
          rendered.push({
            class: row.class,
            class_name: row.class_name,
            template: row.query,
            query: substitute(row.query, vars),
            target_city: city,
            target_state: inputs.client_state,
          });
        }
        continue;
      }

      if (needsCounty && !inputs.county) continue;
      if (needsMetro && !inputs.metro) continue;

      rendered.push({
        class: row.class,
        class_name: row.class_name,
        template: row.query,
        query: substitute(row.query, baseVars),
        target_city: inputs.metro || inputs.county || inputs.client_primary_city,
        target_state: inputs.client_state,
      });
      continue;
    }

    rendered.push({
      class: row.class,
      class_name: row.class_name,
      template: row.query,
      query: substitute(row.query, baseVars),
      target_city: inputs.client_primary_city,
      target_state: inputs.client_state,
    });
  }

  rendered.sort((a, b) => a.class - b.class);
  return rendered;
}

// Sponsorship research targets a location, not a specific client campaign —
// only the target city/state are required to render queries and run research.
export function validateInputs(
  inputs: Partial<ClientInputs>,
): { ok: true; inputs: ClientInputs } | { ok: false; missing: string[] } {
  const required: (keyof ClientInputs)[] = ["client_primary_city", "client_state"];
  const missing: string[] = [];
  for (const k of required) {
    const v = inputs[k];
    if (v === undefined || v === null || v === "") missing.push(k);
  }
  if (missing.length > 0) return { ok: false, missing };

  const filled: ClientInputs = {
    client_business_name: inputs.client_business_name ?? "",
    client_website_url: inputs.client_website_url ?? "",
    client_primary_city: inputs.client_primary_city!,
    client_state: inputs.client_state!,
    client_niche: inputs.client_niche ?? "",
    preferred_landing_page_url: inputs.preferred_landing_page_url ?? "",
    maximum_approved_budget: inputs.maximum_approved_budget ?? 0,
    budget_exceptions_allowed: inputs.budget_exceptions_allowed ?? "No",
    state_abbrev: inputs.state_abbrev,
    county: inputs.county,
    metro: inputs.metro,
    service_area_cities: inputs.service_area_cities,
    nearby_cities_allowed: inputs.nearby_cities_allowed,
    gbp_city: inputs.gbp_city,
    ownership_tags: inputs.ownership_tags,
    client_outreach_email: inputs.client_outreach_email,
  };
  return { ok: true, inputs: filled };
}
