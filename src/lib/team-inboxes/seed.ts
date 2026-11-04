import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { mailboxes, messages, messageAttachments, users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { hideRetainedMessage } from "./retention";
export async function seedTeamInspection(env: CloudflareEnv, ownerId: string, domainId: string) {
	if (env.DEPLOYMENT_ENV !== "local") throw new Error("Team fixtures are local-only");
	const db = getDb(env),
		credentials: { email: string; password: string; archived: boolean }[] = [];
	for (const [localPart, name, archived] of [
		["alice.demo", "Alice Demo", false],
		["ben.demo", "Ben Demo", false],
		["casey.demo", "Casey Demo", true],
	] as const) {
		const email = `${localPart}@example.com`,
			userId = `team_demo_${localPart}`,
			mailboxId = `team_demo_mbx_${localPart}`;
		const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
		if (existing && existing.id !== userId) continue;
		await db
			.insert(users)
			.values({
				id: userId,
				email,
				name,
				passwordHash: hashPassword("team-demo-password"),
				role: localPart === "ben.demo" ? "admin" : "user",
				createdByUserId: ownerId,
				disabled: archived,
				archivedAt: archived ? new Date() : null,
			})
			.onConflictDoNothing();
		await db
			.insert(mailboxes)
			.values({ id: mailboxId, userId, domainId, localPart, displayName: name, type: "personal" })
			.onConflictDoNothing();
		for (const [kind, status, direction] of [
			["inbox", "received", "inbound"],
			["sent", "sent", "outbound"],
			["draft", "draft", "outbound"],
			["trash", "trash", "inbound"],
			["removed", "trash", "outbound"],
		] as const) {
			const id = `team_demo_msg_${localPart}_${kind}`;
			await db
				.insert(messages)
				.values({
					id,
					userId,
					mailboxId,
					fromAddr: direction === "inbound" ? "client@example.test" : email,
					toAddr: direction === "inbound" ? email : "client@example.test",
					subject: `${name}: ${kind} inspection example`,
					textBody: `Synthetic ${kind} message for local inspection testing. No real customer data.`,
					status,
					direction,
					read: direction !== "inbound",
					threadId: `team_demo_thread_${localPart}`,
				})
				.onConflictDoNothing();
			if (kind === "inbox") {
				const key = `attachments/${id}/team_demo_note.txt`;
				await env.BUCKET.put(key, "Synthetic attachment for team inspection.");
				await db
					.insert(messageAttachments)
					.values({
						id: `team_demo_att_${localPart}`,
						messageId: id,
						filename: "inspection-note.txt",
						contentType: "text/plain",
						size: 41,
						r2Key: key,
					})
					.onConflictDoNothing();
			}
			if (kind === "removed") {
				const [message] = await db.select().from(messages).where(eq(messages.id, id));
				if (!message.employeeHiddenAt)
					await hideRetainedMessage(env, message, { id: userId, email }, "removed");
			}
		}
		credentials.push({ email, password: "team-demo-password", archived });
	}
	await db
		.insert(mailboxes)
		.values({
			id: "team_demo_shared",
			userId: ownerId,
			domainId,
			localPart: "team.demo",
			displayName: "Demo Team Shared",
			type: "shared",
		})
		.onConflictDoNothing();
	return credentials;
}
