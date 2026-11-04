import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireActiveAdmin } from "@/lib/accounts/admin-domains";
import type { SessionUser } from "@/lib/auth/types";

const mocks = vi.hoisted(() => ({
	user: vi.fn(),
	env: vi.fn(),
	db: vi.fn(),
	domain: vi.fn(),
	reserve: vi.fn(),
	activation: vi.fn(),
	routing: vi.fn(),
}));
vi.mock("@/lib/auth/cookies", () => ({ requireUser: mocks.user }));
vi.mock("@/lib/cloudflare", () => ({
	getEnv: mocks.env,
	getExecutionContext: () => ({ waitUntil: vi.fn() }),
}));
vi.mock("@/db", () => ({ getDb: mocks.db }));
vi.mock("@/lib/accounts/admin-domains", async (original) => ({
	...(await original<typeof import("@/lib/accounts/admin-domains")>()),
	getAccountDomain: mocks.domain,
	reserveAccountAddress: mocks.reserve,
}));
vi.mock("@/lib/branding/service", () => ({ getBranding: async () => ({ companyName: "Team" }) }));
vi.mock("@/lib/auth/recovery", () => ({
	createUnusablePasswordHash: () => "unusable",
	prepareAccountActivation: mocks.activation,
	deliverAuthEmail: vi.fn(),
}));
vi.mock("@/lib/cloudflare-api", () => ({ ensureEmailRoutingRuleToWorker: mocks.routing }));
vi.mock("@/lib/mailboxes/domain-addresses", () => ({ ensureMailboxDomainRouting: vi.fn() }));
import { POST } from "@/app/api/accounts/route";
const admin = {
	id: "second-admin",
	role: "admin",
	disabled: false,
	activationStatus: "active",
	archivedAt: null,
} as SessionUser;
const account = {
	id: "new-user",
	email: "newperson@configured.test",
	name: "Person",
	role: "user",
	activationStatus: "pending",
	createdAt: new Date(),
	disabled: false,
	resetEmail: "invite@external.test",
	activatedAt: null,
	invitationSentAt: null,
	invitationExpiresAt: null,
};
const request = (domainId = "configured") =>
	new Request("https://mail.test/api/accounts", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			domainId,
			username: "newperson",
			name: "Person",
			role: "user",
			invitationEmail: "invite@external.test",
		}),
	});
let rows: unknown[][];
beforeEach(() => {
	vi.clearAllMocks();
	rows = [[], [], [account]];
	mocks.user.mockResolvedValue(admin);
	mocks.env.mockReturnValue({});
	mocks.domain.mockResolvedValue({
		id: "configured",
		hostname: "configured.test",
		zoneId: "zone",
		userId: "original-admin",
	});
	mocks.reserve.mockResolvedValue(undefined);
	mocks.activation.mockResolvedValue({ status: "delivery_disabled" });
	mocks.db.mockReturnValue({
		select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.shift() ?? [] }) }) }),
		delete: () => ({ where: async () => undefined }),
	});
});
describe("administrator account creation responses", () => {
	it("provisions a configured domain owned by another administrator and attributes the creator", async () => {
		const response = await POST(request());
		expect(response.status).toBe(201);
		expect(mocks.domain).toHaveBeenCalledWith(mocks.db(), admin, "configured");
		expect(mocks.reserve).toHaveBeenCalledWith(
			mocks.db(),
			admin,
			expect.objectContaining({
				createdByUserId: admin.id,
				activationStatus: "pending",
				passwordHash: "unusable",
			}),
			expect.objectContaining({ domainId: "configured", localPart: "newperson" }),
		);
		expect(mocks.activation).toHaveBeenCalledTimes(1);
	});
	it("returns readable 409 for a uniqueness race instead of a provisioning error", async () => {
		mocks.reserve.mockRejectedValue(new Error("UNIQUE constraint failed"));
		rows = [[], [], [{ id: "other-mailbox" }], [{ id: "other-user" }]];
		const response = await POST(request());
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Email address is already assigned" });
		expect(mocks.routing).not.toHaveBeenCalled();
	});
	it("rejects ordinary or disabled accounts and forged domains before provisioning", async () => {
		for (const user of [
			{ ...admin, role: "user" },
			{ ...admin, disabled: true },
			{ ...admin, activationStatus: "pending" },
		]) {
			mocks.user.mockResolvedValue(user);
			expect((await POST(request())).status).toBe(403);
		}
		mocks.user.mockResolvedValue(admin);
		mocks.domain.mockResolvedValue(null);
		expect((await POST(request("forged"))).status).toBe(404);
		expect(mocks.reserve).not.toHaveBeenCalled();
		expect(() => requireActiveAdmin({ ...admin, archivedAt: new Date() })).toThrow("Forbidden");
	});
});
