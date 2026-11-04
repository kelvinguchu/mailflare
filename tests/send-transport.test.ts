/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SEND_TIMEOUT_MS, uploadSend } from "@/components/compose/send-transport";
import type { ComposeSnapshot } from "@/components/compose/types";

afterEach(() => vi.unstubAllGlobals());
describe("bounded multipart browser transport", () => {
	it("uses byte progress and terminates an upload that never confirms", async () => {
		const instances: FakeXHR[] = [];
		class FakeXHR {
			timeout = 0;
			upload: {
				onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void;
				onload?: () => void;
			} = {};
			onerror?: () => void;
			ontimeout?: () => void;
			onabort?: () => void;
			onload?: () => void;
			headers: Record<string, string> = {};
			body?: FormData;
			constructor() {
				instances.push(this);
			}
			open() {}
			setRequestHeader(key: string, value: string) {
				this.headers[key] = value;
			}
			send(body: FormData) {
				this.body = body;
			}
		}
		vi.stubGlobal("XMLHttpRequest", FakeXHR);
		const progress = vi.fn();
		const file = new File(["file contents"], "note.txt");
		const snapshot: ComposeSnapshot = {
			from: "sender@example.test",
			selectedFrom: "sender@example.test",
			to: "recipient@example.test",
			cc: "",
			subject: "Files",
			text: "Attached",
			attachments: [{ id: "file", file }],
			mailboxId: "mailbox",
			sendKey: "original-key",
			undoDelaySeconds: "20",
		};
		const sending = uploadSend(snapshot, progress);
		const rejected = expect(sending).rejects.toThrow("timed out");
		expect(instances[0].timeout).toBe(SEND_TIMEOUT_MS);
		expect(SEND_TIMEOUT_MS).toBe(90000);
		expect(instances[0].headers["Idempotency-Key"]).toBe("original-key");
		instances[0].upload.onprogress!({ loaded: 50, total: 100, lengthComputable: true });
		expect(progress).toHaveBeenCalledWith(50);
		expect((instances[0].body!.get("attachments") as File).name).toBe("note.txt");
		instances[0].ontimeout!();
		await rejected;
	});
});
