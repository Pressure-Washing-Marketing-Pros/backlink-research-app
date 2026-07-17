export const runtime = "nodejs";

export async function GET() {
  const missing: string[] = [];

  if (!process.env.DATAFORSEO_LOGIN) missing.push("DATAFORSEO_LOGIN");
  if (!process.env.DATAFORSEO_PASSWORD) missing.push("DATAFORSEO_PASSWORD");
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");

  return Response.json({
    ready: missing.length === 0,
    missing,
    message:
      missing.length === 0
        ? "All required API environment variables are configured (DataForSEO sponsorship workflow)."
        : "Missing required API environment variables for DataForSEO sponsorship workflow.",
  });
}
