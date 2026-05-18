export const runtime = "nodejs";

export async function GET() {
  const missing: string[] = [];
  if (!process.env.DATAFORSEO_LOGIN) missing.push("DATAFORSEO_LOGIN");
  if (!process.env.DATAFORSEO_PASSWORD) missing.push("DATAFORSEO_PASSWORD");
  if (!process.env.AHREFS_API_TOKEN) missing.push("AHREFS_API_TOKEN");

  return Response.json({
    ready: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? "All required API environment variables are configured."
        : "Missing required API environment variables for DataForSEO / Ahrefs.",
  });
}
