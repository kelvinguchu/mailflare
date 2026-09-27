import type { MetadataRoute } from "next";
import { APP_ROBOTS_RULES } from "@/lib/security/indexing";

export default function robots(): MetadataRoute.Robots {
	return APP_ROBOTS_RULES;
}
