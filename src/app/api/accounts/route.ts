import { z } from "zod";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import {
	createUnusablePasswordHash,
	deliverAuthEmail,
	prepareAccountActivation,
} from "@/lib/auth/recovery";
import { getExecutionContext } from "@/lib/cloudflare";
import { newId } from "@/lib/ids";
import { createUserAccountSchema } from "@/lib/validators";
import { ensureEmailRoutingRuleToWorker } from "@/lib/cloudflare-api";
import { ensureMailboxDomainRouting } from "@/lib/mailboxes/domain-addresses";
import { getBranding } from "@/lib/branding/service";
import { getAccountDomain, reserveAccountAddress } from "@/lib/accounts/admin-domains";
import type { CreateUserAccountInput } from "./types";
import {
	accountListItemFromUser,
	getExistingMailbox,
	listAccountsForAdmin,
	requireAdmin,
} from "./utils";

export async function GET(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;
	const rows = await listAccountsForAdmin(getDb(access.env));
	return NextResponse.json({
		accounts: rows.map((row) => accountListItemFromUser(row)),
	});
}

export async function POST(request: Request) {
	const access = await requireAdmin(request);
	if (access.error) return access.error;

	const parsed = createUserAccountSchema.safeParse(await request.json());
	if (!parsed.success) {
		return NextResponse.json({ error: z.flattenError(parsed.error) }, { status: 400 });
	}

	const input: CreateUserAccountInput = parsed.data;
	const db = getDb(access.env);
	const domain = await getAccountDomain(db, access.user!, input.domainId);
	if (!domain) return NextResponse.json({ error: "Domain not found" }, { status: 404 });
	const username = input.username.toLowerCase().trim();
	const email = `${username}@${domain.hostname}`;
	const invitationEmail = input.invitationEmail.trim().toLowerCase();
	if (invitationEmail === email) {
		return NextResponse.json(
			{ error: "Use an external email address for the invitation" },
			{ status: 400 },
		);
	}
	const name = input.name?.trim() || username;
	const branding = await getBranding(access.env);
	const senderName =
		input.senderName?.trim() ||
		(branding.companyName ? `${name} from ${branding.companyName}` : name);
	const [existing] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });
	const mailbox = await getExistingMailbox(db, domain.id, username);
	if (mailbox)
		return NextResponse.json({ error: "Email address is already assigned" }, { status: 409 });

	const userId = newId("usr");
	const mailboxId = newId("mbx");
	try {
		// D1 batch is atomic; the unique user/address indexes settle concurrent creates.
		await reserveAccountAddress(
			db,
			access.user!,
			{
				id: userId,
				email,
				resetEmail: invitationEmail,
				passwordHash: createUnusablePasswordHash(),
				name,
				role: input.role,
				activationStatus: "pending",
				createdByUserId: access.user!.id,
			},
			{
				id: mailboxId,
				userId,
				domainId: domain.id,
				localPart: username,
				displayName: senderName,
			},
		);
		await ensureEmailRoutingRuleToWorker(access.env, domain.zoneId, email);
		await ensureMailboxDomainRouting(access.env, db, {
			id: mailboxId,
			domainId: domain.id,
			localPart: username,
			useAllDomains: true,
		});
		const invitation = await prepareAccountActivation(access.env, userId);
		if (invitation.status === "pending") {
			getExecutionContext().waitUntil(deliverAuthEmail(access.env, invitation.email));
		}
		const [account] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

		return NextResponse.json(
			{
				account: accountListItemFromUser(account),
				invitationDelivery: invitation.status,
			},
			{ status: 201 },
		);
	} catch (error) {
		await db.delete(users).where(eq(users.id, userId));
		// A competing request may have reserved the address after our initial check.
		const conflict = await getExistingMailbox(db, domain.id, username);
		const [registered] = await db
			.select({ id: users.id })
			.from(users)
			.where(eq(users.email, email))
			.limit(1);
		if (conflict || registered) {
			return NextResponse.json({ error: "Email address is already assigned" }, { status: 409 });
		}
		const message = error instanceof Error ? error.message : "Failed to create account mailbox";
		return NextResponse.json({ error: message }, { status: 502 });
	}
}
