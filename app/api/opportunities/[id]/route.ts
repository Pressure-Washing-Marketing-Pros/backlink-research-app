import {
  getOpportunityById,
  markOpportunityAsUsed,
  updateOpportunityDecision,
  refreshOpportunity,
} from "@/lib/db";
import { domainMetrics } from "@/lib/ahrefs";
import { crawlCandidate } from "@/lib/crawl";
import type { ClientInputs } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      decision?: string;
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

    if (body.action === "setDecision") {
      const decision = body.decision;
      if (decision !== "Approve" && decision !== "Needs Human Review" && decision !== "Reject") {
        return Response.json(
          { error: "decision must be Approve, Needs Human Review, or Reject" },
          { status: 400 },
        );
      }

      const success = await updateOpportunityDecision(
        id,
        decision,
        `Decision manually set to ${decision} by reviewer.`,
      );

      if (!success) {
        return Response.json(
          { error: "Opportunity not found" },
          { status: 404 },
        );
      }

      return Response.json({ success: true });
    }

    if (body.action === "refresh") {
      const existing = await getOpportunityById(id);
      if (!existing) {
        return Response.json(
          { error: "Opportunity not found" },
          { status: 404 },
        );
      }

      const stubInputs = {
        client_business_name: "",
        client_website_url: "",
        client_primary_city: existing.city,
        client_state: existing.state,
        client_niche: "",
        preferred_landing_page_url: "",
        maximum_approved_budget: 0,
        budget_exceptions_allowed: "No",
      } as ClientInputs;

      const [metrics, crawl] = await Promise.all([
        domainMetrics(existing.domain).catch(() => ({
          dr: null,
          organic_traffic: null,
          referring_domains: null,
          error: "Ahrefs lookup failed",
        })),
        crawlCandidate(existing.sponsorship_url, existing.domain, stubInputs).catch((e) => ({
          crawlError: e instanceof Error ? e.message : "Crawl failed",
        })),
      ]);

      const crawlFailed = "crawlError" in crawl && !!crawl.crawlError;
      const note = crawlFailed
        ? `Refresh: could not re-verify sponsorship page (${(crawl as { crawlError?: string }).crawlError}). Existing values kept.`
        : "Refreshed from live site and DR lookup.";

      const success = await refreshOpportunity(id, {
        dr: metrics.dr,
        organic_traffic: metrics.organic_traffic,
        payment_amount: crawlFailed ? undefined : (crawl as { paymentAmount?: string }).paymentAmount,
        payment_type: crawlFailed ? undefined : (crawl as { paymentType?: string }).paymentType,
        submission_method: crawlFailed ? undefined : (crawl as { submissionMethod?: string }).submissionMethod,
        contact_email: crawlFailed ? undefined : (crawl as { contactEmail?: string }).contactEmail,
        link_evidence: crawlFailed ? undefined : (crawl as { linkEvidence?: string }).linkEvidence,
        freshness_notes: crawlFailed
          ? undefined
          : (crawl as { freshnessSiteQualityNotes?: string }).freshnessSiteQualityNotes,
        note,
      });

      if (!success) {
        return Response.json(
          { error: "Opportunity not found" },
          { status: 404 },
        );
      }

      return Response.json({ success: true, note });
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
