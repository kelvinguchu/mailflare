import { beforeEach, describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { consumeSentDraft } from "@/lib/team-inboxes/consume-draft";
import { queueEmail } from "@/lib/email/send";
import { getDb } from "@/db";
import { messages } from "@/db/schema";
import {
	createMailEnv,
	fixtureIds,
	resetIntegrationState,
	seedMailboxWorld,
	sessionUser,
} from "./fixtures";
import { integrationEnv } from "./bindings";
import { getMessageWithBodyForUser } from "@/lib/email/inbound";
import { getAuthorizedAttachment } from "@/lib/email/attachments";
import {
	requestPermanentMessageDeletion,
	requestDraftDeletion,
	runStorageLifecycleMaintenance,
	purgeRetainedMessage,
} from "@/lib/storage/lifecycle";
import { inspectSearch, inspectMessage } from "@/lib/team-inboxes/service";
import { employeeVisible } from "@/lib/team-inboxes/retention";
import { saveInspectedDraft } from "@/lib/team-inboxes/drafts";
import { queryMessageCountAggregates } from "@/app/api/messages/counts/query";
import { exportMailboxToMbox } from "@/lib/export/mbox";
import { applyMessageBulkAction } from "@/app/api/messages/bulk/service";
const env = () => createMailEnv({ DEPLOYMENT_ENV: "local" });
beforeEach(async () => {
	await resetIntegrationState();
	await seedMailboxWorld();
});
async function seed(status = "trash", direction: "inbound" | "outbound" = "inbound") {
	await getDb(env()).insert(messages).values({
		id: "msg_inspect",
		userId: fixtureIds.owner,
		mailboxId: fixtureIds.sharedMailbox,
		direction,
		status,
		fromAddr: "client@example.test",
		toAddr: "support@primary.test",
		subject: "Retain this agreement",
		textBody: "Confidential contract content",
		rawR2Key: "inbound/inspection.eml",
		threadId: "inspection-thread",
		read: false,
	});
	await integrationEnv.BUCKET.put("inbound/inspection.eml", "raw original");
	await integrationEnv.BUCKET.put("attachments/inspection.txt", "attachment original");
	await integrationEnv.DB.prepare(
		"INSERT INTO message_attachments (id,message_id,filename,content_type,size,r2_key,created_at) VALUES ('att_inspect','msg_inspect','agreement.txt','text/plain',19,'attachments/inspection.txt',unixepoch())",
	).run();
}
describe("retained team mail", () => {
	it("hides employee deletion from every ordinary read boundary while preserving inspection and R2", async () => {
		await seed();
		const user = sessionUser(fixtureIds.owner);
		expect((await requestPermanentMessageDeletion(env(), user, "msg_inspect")).outcome).toBe(
			"accepted",
		);
		expect(await getMessageWithBodyForUser(env(), user, "msg_inspect")).toBeNull();
		expect(await getAuthorizedAttachment(env(), user, "msg_inspect", "att_inspect")).toBeNull();
		expect(await getDb(env()).select().from(messages).where(employeeVisible())).toHaveLength(0);
		expect(await exportMailboxToMbox(env(), fixtureIds.sharedMailbox)).not.toContain(
			"Confidential contract",
		);
		expect(
			(
				await queryMessageCountAggregates(
					integrationEnv.DB,
					{ mailboxId: fixtureIds.sharedMailbox },
					false,
				)
			).every((row) => Number(row.total) === 0),
		).toBe(true);
		const inspected = await inspectMessage(env(), "msg_inspect");
		expect(inspected?.body?.textBody).toBe("Confidential contract content");
		expect(inspected?.history[0].actorEmail).toBe(user.email);
		expect(await integrationEnv.BUCKET.head("attachments/inspection.txt")).not.toBeNull();
		const search = await inspectSearch(
			env(),
			new URLSearchParams({ q: "Confidential", deletion: "removed" }),
		);
		expect(search.messages.map((item) => item.id)).toEqual(["msg_inspect"]);
		expect(
			(await getDb(env()).select().from(messages).where(eq(messages.id, "msg_inspect")))[0].read,
		).toBe(false);
	});
	it("expires Trash and intercepts old pending deletion jobs before any R2 deletion", async () => {
		await seed();
		await integrationEnv.DB.prepare(
			"UPDATE messages SET trashed_at = 1 WHERE id = 'msg_inspect'",
		).run();
		await integrationEnv.DB.prepare(
			"INSERT INTO storage_deletion_jobs (id,message_id,reason,status,object_keys,created_at,updated_at) VALUES ('legacy-delete','msg_inspect','user','pending',?,1,1)",
		)
			.bind(JSON.stringify(["inbound/inspection.eml", "attachments/inspection.txt"]))
			.run();
		await runStorageLifecycleMaintenance(env());
		expect((await inspectMessage(env(), "msg_inspect"))?.message.employeeHiddenAt).not.toBeNull();
		expect(await integrationEnv.BUCKET.head("inbound/inspection.eml")).not.toBeNull();
	});
	it("preserves original attribution and pre-trash placement through transfers and restoration", async () => {
		await seed("sent", "outbound");
		await integrationEnv.DB.prepare(
			"UPDATE messages SET status='trash' WHERE id='msg_inspect'",
		).run();
		let [message] = await getDb(env()).select().from(messages);
		expect(message.deletionOriginalStatus).toBe("sent");
		expect(await applyMessageBulkAction(getDb(env()), [message], "inbox", true)).toEqual([
			"msg_inspect",
		]);
		[message] = await getDb(env()).select().from(messages);
		expect(message.status).toBe("sent");
		await integrationEnv.DB.prepare("UPDATE messages SET user_id=? WHERE id='msg_inspect'")
			.bind(fixtureIds.stranger)
			.run();
		expect((await inspectMessage(env(), "msg_inspect"))?.message.originalUserEmail).toBe(
			"owner@primary.test",
		);
	});
	it("requires the designated owner and hidden state for physical deletion", async () => {
		await seed();
		expect(
			(await purgeRetainedMessage(env(), sessionUser(fixtureIds.stranger), "msg_inspect")).outcome,
		).toBe("not_allowed");
		await requestPermanentMessageDeletion(env(), sessionUser(fixtureIds.owner), "msg_inspect");
		const inspector = { ...sessionUser(fixtureIds.owner), email: "admin@example.com" };
		expect(await purgeRetainedMessage(env(), inspector, "msg_inspect")).toMatchObject({
			outcome: "accepted",
			completed: true,
		});
		expect(await integrationEnv.BUCKET.head("attachments/inspection.txt")).toBeNull();
		expect(await inspectMessage(env(), "msg_inspect")).toBeNull();
	});
	it("retains discarded drafts and rejects stale saves without losing the retained attachment", async () => {
		const form = new FormData();
		form.set(
			"payload",
			JSON.stringify({
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
				to: "client@example.test",
				subject: "Draft agreement",
				text: "Saved draft content",
			}),
		);
		form.append("attachments", new File(["draft attachment"], "draft.txt", { type: "text/plain" }));
		const response = await saveInspectedDraft(
			env(),
			sessionUser(fixtureIds.owner),
			new Request("https://local/api/drafts", { method: "POST", body: form }),
		);
		expect(response.status).toBe(200);
		const data = (await response.json()) as { draft: { id: string; revision: number } };
		await requestDraftDeletion(env(), fixtureIds.owner, data.draft.id);
		const stale = await saveInspectedDraft(
			env(),
			sessionUser(fixtureIds.owner),
			new Request("https://local/api/drafts/x", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					from: "support@primary.test",
					mailboxId: fixtureIds.sharedMailbox,
					text: "Overwrite",
					revision: data.draft.revision,
				}),
			}),
			data.draft.id,
		);
		expect(stale.status).toBe(404);
		const inspected = await inspectMessage(env(), data.draft.id);
		expect(inspected?.body?.textBody).toBe("Saved draft content");
		expect(inspected?.attachments[0].filename).toBe("draft.txt");
		expect(inspected?.history[0].action).toBe("draft_discarded");
	});
	it("keeps failed draft uploads and concurrent saves from replacing the final saved state", async () => {
		await seed("draft", "outbound");
		const form = new FormData();
		form.set(
			"payload",
			JSON.stringify({
				mailboxId: fixtureIds.sharedMailbox,
				from: "support@primary.test",
				text: "Unsaved replacement",
				revision: 0,
			}),
		);
		form.append("attachments", new File(["new bytes"], "new.txt", { type: "text/plain" }));
		const failedBucket = new Proxy(integrationEnv.BUCKET, {
			get(target, property) {
				if (property === "put")
					return async () => {
						throw new Error("Simulated R2 failure");
					};
				const value = Reflect.get(target, property);
				return typeof value === "function" ? value.bind(target) : value;
			},
		});
		const response = await saveInspectedDraft(
			createMailEnv({ DEPLOYMENT_ENV: "local", BUCKET: failedBucket }),
			sessionUser(fixtureIds.owner),
			new Request("https://local/api/drafts/x", { method: "PATCH", body: form }),
			"msg_inspect",
		);
		expect(response.status).toBe(503);
		expect((await inspectMessage(env(), "msg_inspect"))?.body?.textBody).toBe(
			"Confidential contract content",
		);
		expect(await integrationEnv.BUCKET.head("attachments/inspection.txt")).not.toBeNull();
		const save = (text: string) =>
			saveInspectedDraft(
				env(),
				sessionUser(fixtureIds.owner),
				new Request("https://local/api/drafts/x", {
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						mailboxId: fixtureIds.sharedMailbox,
						from: "support@primary.test",
						text,
						revision: 0,
					}),
				}),
				"msg_inspect",
			);
		expect(
			(await Promise.all([save("First"), save("Second")])).map((item) => item.status).sort(),
		).toEqual([200, 409]);
	});
	it("consumes a sent draft only when its entire saved content matches the accepted send", async () => {
		const payload = {
			mailboxId: fixtureIds.sharedMailbox,
			from: "support@primary.test",
			to: "client@example.test",
			subject: "Agreement",
			text: "Complete content",
		};
		const response = await saveInspectedDraft(
			env(),
			sessionUser(fixtureIds.owner),
			new Request("https://local/api/drafts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			}),
		);
		const { draft } = (await response.json()) as { draft: { id: string } };
		const queuedEnv = createMailEnv({
			DEPLOYMENT_ENV: "local",
			OUTBOUND_QUEUE: { send: async () => {} } as unknown as Queue,
		});
		const wrong = await queueEmail(queuedEnv, {
			...payload,
			userId: fixtureIds.owner,
			to: "different@example.test",
		});
		expect(await consumeSentDraft(env(), fixtureIds.owner, draft.id, wrong.messageId)).toBe(false);
		const sent = await queueEmail(queuedEnv, { ...payload, userId: fixtureIds.owner });
		expect(await consumeSentDraft(env(), fixtureIds.owner, draft.id, sent.messageId)).toBe(true);
		expect(await inspectMessage(env(), draft.id)).toBeNull();
		expect((await inspectMessage(env(), sent.messageId))?.body?.textBody).toBe(payload.text);
		expect(
			(
				await integrationEnv.DB.prepare(
					"SELECT COUNT(*) AS count FROM message_deletion_events WHERE message_id = ?",
				)
					.bind(draft.id)
					.first<{ count: number }>()
			)?.count,
		).toBe(0);
	});

	it("keeps quarantined bodies inaccessible even in owner inspection", async () => {
		await seed();
		await integrationEnv.DB.prepare(
			"UPDATE messages SET security_status='quarantined' WHERE id='msg_inspect'",
		).run();
		expect((await inspectMessage(env(), "msg_inspect"))?.body).toBeNull();
	});
});
