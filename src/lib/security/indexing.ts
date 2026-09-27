import type { Metadata, MetadataRoute } from "next";

/**
 * CC Mail is an internal application. These directives ask crawlers not to index or follow
 * it; they are indexing controls only. Authentication and API authorization remain the access
 * control.
 */
export const ROBOTS_DIRECTIVE = "noindex, nofollow";

export const APP_ROBOTS_METADATA: NonNullable<Metadata["robots"]> = {
	index: false,
	follow: false,
	googleBot: { index: false, follow: false },
};

export const APP_ROBOTS_RULES: MetadataRoute.Robots = {
	rules: { userAgent: "*", disallow: "/" },
};
