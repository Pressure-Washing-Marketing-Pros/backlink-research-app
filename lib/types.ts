export type YesNo = "Yes" | "No";

export type OwnershipTag =
  | "veteran-owned"
  | "family-owned"
  | "women-owned"
  | "minority-owned"
  | "nonprofit-friendly";

export interface ClientInputs {
  client_business_name: string;
  client_website_url: string;
  client_primary_city: string;
  client_state: string;
  client_niche: string;
  preferred_landing_page_url: string;
  maximum_approved_budget: number;
  budget_exceptions_allowed: YesNo;

  state_abbrev?: string;
  county?: string;
  metro?: string;
  service_area_cities?: string[];
  nearby_cities_allowed?: YesNo;
  gbp_city?: string;
  ownership_tags?: OwnershipTag[];
  client_outreach_email?: string;
}

export interface QueryBankRow {
  class: 1 | 2 | 3 | 4;
  class_name: string;
  query: string;
}

export interface RenderedQuery {
  class: 1 | 2 | 3 | 4;
  class_name: string;
  template: string;
  query: string;
  target_city: string;
  target_state: string;
}

export interface SerpResult {
  title: string;
  url: string;
  root_domain: string;
  rank: number;
  search_query_used: string;
  target_city: string;
  target_state: string;
}

export interface AhrefsMetrics {
  dr: number | null;
  organic_traffic: number | null;
  referring_domains: number | null;
  error?: string;
}

export interface SponsorshipCrawlResult {
  sponsorshipUrl: string;
  sponsorPageUrl: string;
  opportunityType: string;
  city: string;
  state: string;
  currentSponsorsDisplayedPublicly: YesNo | "Unknown";
  currentSponsorsLinked: YesNo | "Unknown";
  linkOpportunityStatus: LinkOpportunityStatus | "Unknown";
  linkEvidence: string;
  paymentAmount: string;
  paymentType: PaymentType;
  cheapestTierWithLink: string;
  tierName: string;
  submissionMethod: SubmissionMethod;
  submissionUrl: string;
  contactEmail: string;
  contactPerson: string;
  freshnessSiteQualityNotes: string;
  crawlNotes: string;
  crawlError?: string;
}

export type LocalRelevanceRating = "High" | "Medium" | "Low" | "Unknown";
export type LinkOpportunityStatus =
  | "Confirmed"
  | "Probable"
  | "Unclear"
  | "No Link Opportunity";
export type PaymentType = "One-Time" | "Annual" | "Monthly" | "Recurring" | "Unknown";
export type SubmissionMethod = "Form" | "Email" | "Phone" | "PDF Package" | "Unknown";
export type Decision = "Approve" | "Reject" | "Needs Human Review";

export interface Opportunity {
  Client: string;
  "Target City": string;
  "Opportunity Name": string;
  Domain: string;
  "Opportunity Type": string;
  "Sponsorship URL": string;
  "Sponsor Page URL": string;
  City: string;
  State: string;
  "Local Relevance Rating": LocalRelevanceRating;
  "Local Relevance Notes": string;
  "Current Sponsors Displayed Publicly": YesNo | "Unknown";
  "Current Sponsors Linked": YesNo | "Unknown";
  "Link Opportunity Status": LinkOpportunityStatus | "Unknown";
  "Link Evidence": string;
  "Payment Amount": string;
  "Payment Type": PaymentType;
  "Cheapest Tier With Link": string;
  "Tier Name": string;
  "Submission Method": SubmissionMethod;
  "Submission URL": string;
  "Contact Email": string;
  "Contact Person": string;
  DR: number | "Unknown";
  DA: number | "Unknown";
  Traffic: number | "Unknown";
  HTTPS: YesNo;
  "Freshness / Site Quality Notes": string;
  Notes: string;
  Decision: Decision;
  "Human Review Trigger": string;
  Score: number;
  "Search Query Used": string;
}

export interface RunSummary {
  client: string;
  target_city: string;
  target_state: string;
  run_date: string;
  total_candidates_reviewed: number;
  approved_count: number;
  review_count: number;
  rejected_count: number;
  queries_used: string[];
}

export interface RunResult {
  summary: RunSummary;
  opportunities: Opportunity[];
}

export interface ValidationError {
  status: "Missing Required Inputs";
  missing_fields: string[];
}
