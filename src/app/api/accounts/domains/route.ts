import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { listAccountDomains } from "@/lib/accounts/admin-domains";
import { requireAdmin } from "../utils";

export async function GET(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	return NextResponse.json({ domains: await listAccountDomains(getDb(access.env), access.user!) });
}
