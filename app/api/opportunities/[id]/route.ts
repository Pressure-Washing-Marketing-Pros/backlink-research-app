import {
  getOpportunityById,
  markOpportunityAsUsed,
  updateOpportunityDecision,
  refreshOpportunity,
  deleteOpportunity,
} from "@/lib/db";
import { contentAnalyze, onPageAnalyzeUrl } from "@/lib/dataforseo";

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
      rejectionReason?: string;
      rejectionNotes?: string;
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

      if (decision === "Reject" && !String(body.rejectionReason || "").trim()) {
        return Response.json(
          { error: "rejectionReason is required when decision is Reject" },
          { status: 400 },
        );
      }

      const success = await updateOpportunityDecision(
        id,
        decision,
        `Decision manually set to ${decision} by reviewer.`,
        body.rejectionReason,
        body.rejectionNotes,
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

      const sourceUrl = existing.sponsorship_url || existing.sponsor_page_url;
      const page = await onPageAnalyzeUrl(sourceUrl, { useJavaScript: false }).catch((e) => ({
        ok: false,
        sourceUrl,
        finalUrl: sourceUrl,
        canonicalUrl: "",
        statusCode: null,
        title: "",
        metaDescription: "",
        headings: [],
        text: "",
        html: "",
        internalLinks: [],
        externalLinks: [],
        usedJavaScript: false,
        error: e instanceof Error ? e.message : "Refresh crawl failed",
      }));

      const note = page.ok
        ? "Refreshed with DataForSEO OnPage + Content Analysis."
        : `Refresh crawl failed: ${page.error || "Unknown error"}`;

      const content = page.ok
        ? await contentAnalyze(
            page.finalUrl,
            `${page.title}\n${page.metaDescription}\n${page.headings.join("\n")}\n${page.text}`,
          )
        : {
            ok: false,
            summary: "",
            hasSponsorshipOpportunity: false,
            sponsorshipSignals: [],
            pricingSignals: [],
            contactSignals: [],
            opportunityType: "Unknown",
            cheapestTierWithLink: "Unknown",
            error: page.error || "Refresh crawl failed",
          };

      const success = await refreshOpportunity(id, {
        payment_amount:
          content.pricingSignals.length > 0
            ? content.pricingSignals[0]
            : page.ok
              ? "Unknown"
              : undefined,
        link_evidence: page.ok
          ? content.hasSponsorshipOpportunity
            ? "Potential sponsorship indicators detected via content analysis."
            : "No clear sponsorship indicators detected in refreshed content."
          : undefined,
        freshness_notes: page.ok
          ? `Page refreshed at ${new Date().toISOString()} (${page.usedJavaScript ? "JS" : "standard"} crawl).`
          : undefined,
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

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const success = await deleteOpportunity(id);
    if (!success) {
      return Response.json(
        { error: "Opportunity not found" },
        { status: 404 },
      );
    }
    return Response.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error deleting opportunity:", error);
    return Response.json({ error: message }, { status: 500 });
  }
}
