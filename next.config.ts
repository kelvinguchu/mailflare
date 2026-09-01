import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { getSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
	turbopack: {
		root: import.meta.dirname,
	},
  allowedDevOrigins: ['mail.dev'],
	typescript: {
    // !! WARN !!
    // Dangerously allow production builds to successfully complete
    // even if your project has type errors.
    ignoreBuildErrors: true,
	  },
	async headers() {
		return [
			{
				source: "/(.*)",
				headers: getSecurityHeaders(),
			},
		];
	},
};

export default async function config(): Promise<NextConfig> {
	// Await the bindings so the first request cannot race Cloudflare initialization.
	await initOpenNextCloudflareForDev();
	return nextConfig;
}
