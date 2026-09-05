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
	// The remote binding proxy is development-only. Production builds use the
	// generated OpenNext Worker bindings and must not require a local API token.
	if (process.env.NODE_ENV === "development") {
		await initOpenNextCloudflareForDev();
	}
	return nextConfig;
}
