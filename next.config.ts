import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/run": ["./skills/sponsorship/query-bank.csv"],
  },
};

export default nextConfig;
