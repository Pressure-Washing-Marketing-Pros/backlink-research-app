// Resolves the true geographic scope of a sponsorship opportunity from what
// the page actually says — never just the query bucket it was found under.
// A statewide query can surface a city-specific page (e.g. "Snap Orlando"
// found via a Florida-wide search) and vice versa, so every candidate is
// re-checked here regardless of sourceScope.
import type { ClientInputs, QueryScope } from "@/lib/types";

export interface LocationResolution {
  scope: QueryScope | "unclear";
  city: string;
  county: string;
  state: string;
  label: string;
  confidence: "high" | "medium" | "low";
  evidence: string;
}

const STATEWIDE_LANGUAGE =
  /\bstatewide\b|\bstate[- ]wide\b|\backross the state\b|\bthroughout the state\b|\ball of [a-z]+ state\b/i;

// Catches a city name the client didn't configure (e.g. a statewide query
// surfacing an Orlando-specific org) via a mailing-address pattern like
// "123 Main St, Orlando, FL 32801" — common in footers/contact pages.
const ADDRESS_CITY_PATTERN = /,\s*([A-Z][A-Za-z. ]{2,30}),\s*[A-Z]{2}\s*\d{5}/;

function includesTerm(haystack: string, term: string): boolean {
  if (!term) return false;
  return haystack.includes(term.toLowerCase());
}

export function resolveLocation(params: {
  sourceScope: QueryScope;
  title: string;
  url: string;
  domain: string;
  scrapedText: string;
  inputs: ClientInputs;
}): LocationResolution {
  const { sourceScope, title, url, domain, scrapedText, inputs } = params;
  const blob = `${title} ${url} ${domain} ${scrapedText.slice(0, 4000)}`;
  const lowerBlob = blob.toLowerCase();

  const city = inputs.client_primary_city || "";
  const county = inputs.county || "";
  const state = inputs.client_state || "";
  const stateAbbrev = inputs.state_abbrev || "";

  const cityHit = includesTerm(lowerBlob, city);
  const countyBareName = county.replace(/\s+county\s*$/i, "").trim();
  const countyHit =
    includesTerm(lowerBlob, county) ||
    (!!countyBareName && includesTerm(lowerBlob, countyBareName));
  const stateHit = includesTerm(lowerBlob, state) || includesTerm(lowerBlob, stateAbbrev);
  const statewideLanguage = STATEWIDE_LANGUAGE.test(blob) && stateHit;

  // Priority 1: a specific city found in title, domain, URL, or scraped content.
  if (cityHit) {
    return {
      scope: "city",
      city,
      county: countyHit ? county : "",
      state,
      label: `${city}, ${state}`,
      confidence: "high",
      evidence: `"${city}" found in the page title, URL, domain, or content.`,
    };
  }

  // Priority 2: a specific county found in title, domain, URL, or content.
  if (countyHit) {
    return {
      scope: "county",
      city: "",
      county,
      state,
      label: `${county}, ${state}`,
      confidence: "high",
      evidence: `"${county}" found in the page title, URL, domain, or content.`,
    };
  }

  // Priority 1b: a mailing-address city the client didn't configure — still
  // more specific than a county/state guess.
  const addressMatch = blob.match(ADDRESS_CITY_PATTERN);
  if (addressMatch && stateHit) {
    const foundCity = addressMatch[1].trim();
    return {
      scope: "city",
      city: foundCity,
      county: "",
      state,
      label: `${foundCity}, ${state}`,
      confidence: "medium",
      evidence: `Mailing address found for "${foundCity}" in the page content.`,
    };
  }

  // Priority 3: explicit statewide language, corroborated by a state mention.
  if (statewideLanguage) {
    return {
      scope: "state",
      city: "",
      county: "",
      state,
      label: `${state}, statewide`,
      confidence: "medium",
      evidence: "Explicit statewide language found in the page content.",
    };
  }

  // Priority 4: fall back to the scope of the query that surfaced this result.
  if (sourceScope === "city" && city) {
    return {
      scope: "city",
      city,
      county: "",
      state,
      label: `${city}, ${state}`,
      confidence: "low",
      evidence: "No confident location signal found on the page — falling back to the city query scope.",
    };
  }
  if (sourceScope === "county" && county) {
    return {
      scope: "county",
      city: "",
      county,
      state,
      label: `${county}, ${state}`,
      confidence: "low",
      evidence: "No confident location signal found on the page — falling back to the county query scope.",
    };
  }
  if (sourceScope === "state" && stateHit) {
    return {
      scope: "state",
      city: "",
      county: "",
      state,
      label: `${state}, statewide`,
      confidence: "low",
      evidence: "State mentioned but no specific city/county evidence — falling back to the statewide query scope.",
    };
  }

  // Priority 5: nothing confident enough to resolve.
  return {
    scope: "unclear",
    city: "",
    county: "",
    state,
    label: "Location unclear",
    confidence: "low",
    evidence: "No confident city, county, or statewide signal found in the title, URL, domain, or content.",
  };
}
