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
  maximum_approved_budget?: number;
  budget_exceptions_allowed?: YesNo;

  state_abbrev?: string;
  county?: string;
  metro?: string;
  service_area_cities?: string[];
  nearby_cities_allowed?: YesNo;
  gbp_city?: string;
  ownership_tags?: OwnershipTag[];
  client_outreach_email?: string;
}

/** Which geographic level a query was generated for. */
export type QueryScope = "city" | "county" | "state";

export interface QueryBankRow {
  class: 1 | 2 | 3 | 4 | 5;
  class_name: string;
  scope: QueryScope;
  query: string;
}

export interface RenderedQuery {
  class: 1 | 2 | 3 | 4 | 5;
  class_name: string;
  scope: QueryScope;
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
  /** SERP result description/snippet — used by the pre-filter. */
  snippet: string;
  breadcrumb?: string;
  serp_result_type?: string;
  search_query_used: string;
  target_city: string;
  target_state: string;
  /** Which query bucket (city/county/state) produced this result. */
  query_scope?: QueryScope;
}

export type AhrefsErrorCategory =
  | "api_key_missing"
  | "rate_limited"
  | "quota_exceeded"
  | "invalid_domain"
  | "request_failed"
  | "response_mapping_failed"
  | "no_data_returned";

export interface AhrefsMetrics {
  dr: number | null;
  organic_traffic: number | null;
  referring_domains: number | null;
  error?: string;
  /** Machine-readable reason when dr/organic_traffic are null — lets the UI
   *  show a specific cause instead of a single generic "DR unavailable". */
  errorCategory?: AhrefsErrorCategory;
  status: "success" | "failed";
  checkedAt: string;
  /** The exact domain string sent to the Ahrefs API — helps catch cases
   *  where a full URL or malformed value was sent instead of a root domain. */
  targetUsed: string;
  /** Truncated raw response body, only populated on failure, for debugging. */
  rawResponsePreview?: string;
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
export type PaymentType = "One-Time" | "Per event" | "Annual" | "Monthly" | "Recurring" | "Free" | "Unknown" | "Other";
export type SubmissionMethod = "Form" | "Email" | "Phone" | "PDF Package" | "Unknown";
export type Decision = "Approve" | "Reject" | "Needs Human Review";
export type ApprovalStatus = "approved" | "review" | "rejected";
export type TechnicalStatus =
  | "Pending crawl"
  | "Crawling"
  | "Crawl completed"
  | "Content analysis completed"
  | "Crawl failed"
  | "Blocked"
  | "Invalid URL"
  | "No sponsorship content found"
  | "Duplicate"
  | "Previously reviewed";
export type BudgetFitStatus =
  | "In Budget"
  | "Over Budget"
  | "Over Budget (Exception Allowed)"
  | "Price Unknown";

/**
 * What the scraped page actually IS. Only the first four are eligible for
 * approval — everything else is rejected or reviewed, never approved.
 */
export type PagePurpose =
  | "SponsorshipOpportunityPage"
  | "SponsorPacketOrForm"
  | "DonationOrPartnerPage"
  | "VendorOrExhibitorOpportunityPage"
  | "CurrentSponsorsOnlyPage"
  | "BlogArticle"
  | "NewsArticle"
  | "TravelOrReviewPage"
  | "JobPosting"
  | "ForumThread"
  | "SocialMediaPage"
  | "GenericEventPage"
  | "TicketOrRegistrationPage"
  | "DirectoryListing"
  | "Unknown";

export type RejectionCategory =
  | "Blog/article result"
  | "Travel/review result"
  | "Job/visa sponsorship result"
  | "Forum/social result"
  | "Generic event/ticket result"
  | "Current sponsors only"
  | "No sponsorship opportunity language"
  | "No backlink evidence"
  | "No pricing found"
  | "Over budget"
  | "DR below threshold"
  | "Low local relevance"
  | "Firecrawl failed"
  | "Unknown";

/**
 * Internal per-URL analysis produced by the strict scrape-and-match layer
 * (Ahrefs DR gate → Firecrawl scrape → keyword/price matching). Attached to
 * each Opportunity as `_analysis`; not part of the CSV export columns.
 */
export interface PageAnalysis {
  normalizedUrl: string;
  sourceUrl: string;
  finalUrl: string;
  domain: string;
  ahrefsDR: number | null;
  firecrawlStatus: "success" | "failed" | "cached" | "skipped";
  pageTitle: string;
  /** Preview only (first 2,000 chars) — full text lives in the crawl_cache table. */
  scrapedText: string;
  matchedSponsorshipTerms: string[];
  matchedBacklinkTerms: string[];
  matchedPricingTerms: string[];
  detectedPrices: number[];
  lowestDetectedPrice: number | null;
  withinBudget: boolean | null;
  pagePurpose: PagePurpose;
  rejectionCategory: RejectionCategory | null;
  approvalStatus: ApprovalStatus;
  approvalReason: string;
  analyzedAt: string;
  crawlCached: boolean;
}

export interface PipelineStats {
  serp_results: number;
  after_dedup: number;
  unique_domains_found: number;
  approved_duplicates_skipped: number;
  needs_review_duplicates_skipped: number;
  rejected_duplicates_skipped: number;
  serp_filtered_out: number;
  onpage_sent: number;
  onpage_standard_completed: number;
  onpage_js_completed: number;
  onpage_failed: number;
  redirected_urls: number;
  post_crawl_duplicates_skipped: number;
  content_analysis_sent: number;
  content_analysis_skipped?: number;
  sponsorship_found: number;
  no_sponsorship_found: number;
  new_needs_review_created: number;
  technical_failures_requiring_review: number;
  approved: number;
  needs_review: number;
  rejected: number;
}

export interface Opportunity {
  Client: string;
  "Target City": string;
  "Opportunity Name": string;
  Domain: string;
  "Opportunity Type": string;
  "Review Status"?: "Needs Review" | "Approved" | "Rejected";
  "Technical Status"?: TechnicalStatus;
  "Technical Notes"?: string;
  "Original Discovery URL"?: string;
  "Opportunity URL"?: string;
  "Sponsorship URL": string;
  "Sponsor Page URL": string;
  "State Abbreviation"?: string;
  Metro?: string;
  "Location Classification"?: "City" | "County" | "Metro" | "Statewide" | "Regional" | "Unknown";
  "Event Name"?: string;
  City: string;
  County: string;
  State: string;
  Location: string;
  "Source Query Scopes": string;
  "SERP Prequalification Status"?:
    | "Qualified for Firecrawl"
    | "Qualified for DataForSEO OnPage"
    | "Rejected at SERP Filter"
    | "Skipped Duplicate"
    | "Needs SERP Review";
  "Resolved Location Scope": QueryScope | "unclear";
  "Location Confidence": "high" | "medium" | "low";
  "Location Evidence": string;
  "Local Relevance Rating": LocalRelevanceRating;
  "Local Relevance Notes": string;
  "Current Sponsors Displayed Publicly": YesNo | "Unknown";
  "Current Sponsors Linked": YesNo | "Unknown";
  "Link Opportunity Status": LinkOpportunityStatus | "Unknown";
  "Link Evidence": string;
  "Payment Amount": string;
  "Pricing Notes"?: string;
  "Sponsorship Tiers"?: string;
  "Website Link Included"?: "Yes" | "No" | "Unknown";
  "Logo Included"?: "Yes" | "No" | "Unknown";
  "Budget Fit"?: BudgetFitStatus;
  "Payment Type": PaymentType;
  "Payment Method"?: string;
  "Cheapest Tier With Link": string;
  "Tier Name": string;
  "Submission Method": SubmissionMethod;
  "Submission URL": string;
  "Contact Email": string;
  "Contact Person": string;
  "Contact Page URL"?: string;
  "Contact Page Fallback Used"?: "Yes" | "No";
  "Event Date"?: string;
  Deadline?: string;
  "Rejection Reason"?:
    | "Too expensive"
    | "No active sponsorship opportunity"
    | "No website link included"
    | "Not locally relevant"
    | "Wrong location"
    | "Duplicate opportunity"
    | "Organization appears inactive"
    | "Page is outdated"
    | "Opportunity expired"
    | "Unable to verify"
    | "Unable to contact"
    | "Benefits do not justify the cost"
    | "Irrelevant result"
    | "Other";
  "Rejection Notes"?: string;
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
  "Last Checked": string;
  "Last Refreshed": string;
  /** Internal strict-analysis result; excluded from OPPORTUNITY_COLUMNS/CSV. */
  _analysis?: PageAnalysis;
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
  pipeline_stats?: PipelineStats;
}

export interface RunResult {
  summary: RunSummary;
  opportunities: Opportunity[];
  warning?: string;
}

export interface ValidationError {
  status: "Missing Required Inputs";
  missing_fields: string[];
}
