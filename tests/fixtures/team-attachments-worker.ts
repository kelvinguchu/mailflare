import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { queueEmail, processOutboundQueue, getSendOutcome } from "@/lib/email/send";
import { serveAuthorizedAttachment } from "@/lib/email/attachment-response";

const worker = {
	async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
		try {
			const url = new URL(request.url);
			const calls: { filename: string; bytes: number[] }[][] = [];
			const mailEnv = {
				...env,
				OUTBOUND_DELIVERY_MODE: "enabled",
				OUTBOUND_QUEUE: { send: async () => undefined },
				EMAIL: {
					send: async (message: { attachments?: { filename: string; content: ArrayBuffer }[] }) => {
						calls.push(
							(message.attachments ?? []).map((file) => ({
								filename: file.filename,
								bytes: Array.from(new Uint8Array(file.content)),
							})),
						);
						return { messageId: "provider-fixture" };
					},
				},
			} as unknown as CloudflareEnv;
			const base = {
				userId: "usr_owner",
				mailboxId: "mbx_shared",
				from: "support@primary.test",
				to: "recipient@example.test",
				subject: "Files",
				text: "Attached",
			};
			if (url.pathname === "/send-case") {
				const files = ["one.txt", "report.pdf", "photo.png"].map((filename, index) => ({
					filename,
					type: "application/octet-stream",
					content: new Uint8Array([0, 255, index]).buffer,
				}));
				const input = { ...base, attachments: files };
				const [first, repeated] = await Promise.all([
					queueEmail(mailEnv, input, { idempotencyKey: "attachment-worker-case" }),
					queueEmail(mailEnv, input, { idempotencyKey: "attachment-worker-case" }),
				]);
				const queued = await getSendOutcome(mailEnv, "usr_owner", "attachment-worker-case");
				const otherUser = await getSendOutcome(mailEnv, "usr_stranger", "attachment-worker-case");
				await processOutboundQueue(mailEnv, { jobId: first.jobId }, { attempt: 1 });
				await processOutboundQueue(mailEnv, { jobId: first.jobId }, { attempt: 2 });
				let sizeError: unknown;
				try {
					await queueEmail(
						mailEnv,
						{
							...base,
							text: "x".repeat(500000),
							attachments: [
								{
									filename: "large.bin",
									type: "application/octet-stream",
									content: new Uint8Array(3 * 1024 * 1024).buffer,
								},
							],
						},
						{ idempotencyKey: "oversized-worker-case" },
					);
				} catch (error) {
					const problem = error as { code: string; status: number };
					sizeError = { code: problem.code, status: problem.status };
				}
				const accepted = await getSendOutcome(mailEnv, "usr_owner", "attachment-worker-case");
				return Response.json({
					first,
					repeated,
					queued,
					otherUser,
					accepted,
					calls,
					sizeError,
					objects: (await env.BUCKET.list()).objects.length,
					attachments: await env.DB.prepare(
						"SELECT COUNT(*) AS count FROM message_attachments",
					).first(),
				});
			}
			if (url.pathname === "/preview-setup") {
				const bytes = new TextEncoder().encode("%PDF-1.7\n0123456789").buffer;
				const queued = await queueEmail(mailEnv, {
					...base,
					attachments: [{ filename: "report.pdf", type: "application/pdf", content: bytes }],
				});
				const attachment = await env.DB.prepare(
					"SELECT id FROM message_attachments WHERE message_id=?",
				)
					.bind(queued.messageId)
					.first<{ id: string }>();
				return Response.json({
					messageId: queued.messageId,
					attachmentId: attachment!.id,
					size: bytes.byteLength,
				});
			}
			if (url.pathname === "/preview") {
				const [user] = await getDb(env)
					.select()
					.from(users)
					.where(eq(users.id, request.headers.get("X-Test-User") ?? "usr_owner"))
					.limit(1);
				if (!user) return new Response("Unauthorized", { status: 401 });
				return serveAuthorizedAttachment(
					env,
					user,
					request,
					url.searchParams.get("messageId")!,
					url.searchParams.get("attachmentId")!,
					request.method === "HEAD",
				);
			}
			return new Response("Not found", { status: 404 });
		} catch (error) {
			return Response.json(
				{ error: error instanceof Error ? error.message : String(error) },
				{ status: 500 },
			);
		}
	},
};
export default worker;
