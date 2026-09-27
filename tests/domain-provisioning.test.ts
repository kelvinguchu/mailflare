import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	createSendingSubdomain: vi.fn(),
	enableEmailRouting: vi.fn(),
	ensureEmailRoutingCatchAllToWorker: vi.fn(),
	findZoneByHostname: vi.fn(),
	listSendingSubdomains: vi.fn(),
}));

vi.mock("@/lib/cloudflare-api", () => ({
	createSendingSubdomain: mocks.createSendingSubdomain,
	enableEmailRouting: mocks.enableEmailRouting,
	findZoneByHostname: mocks.findZoneByHostname,
	listSendingSubdomains: mocks.listSendingSubdomains,
}));
vi.mock("@/lib/domains/catch-all-routing", () => ({
	ensureEmailRoutingCatchAllToWorker: mocks.ensureEmailRoutingCatchAllToWorker,
}));

import { provisionDomainOnCloudflare } from "../src/lib/domains/provision";

const env = {} as CloudflareEnv;

describe("Cloudflare domain provisioning", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findZoneByHostname.mockResolvedValue({ id: "zone_1", name: "example.com" });
		mocks.enableEmailRouting.mockResolvedValue({ enabled: true, status: "ready" });
		mocks.ensureEmailRoutingCatchAllToWorker.mockResolvedValue({});
	});

	it("records an already-onboarded apex domain as enabled for sending", async () => {
		mocks.listSendingSubdomains.mockResolvedValue([
			{ tag: "sending_apex", name: "example.com", enabled: true },
		]);

		const result = await provisionDomainOnCloudflare(env, "Example.COM");

		expect(mocks.listSendingSubdomains).toHaveBeenCalledWith(env, "zone_1");
		expect(mocks.createSendingSubdomain).not.toHaveBeenCalled();
		expect(result).toMatchObject({
			hostname: "example.com",
			sendingEnabled: true,
			sendingSubdomainTag: "sending_apex",
		});
	});

	it("onboards an apex domain when it is not already configured for sending", async () => {
		mocks.listSendingSubdomains.mockResolvedValue([]);
		mocks.createSendingSubdomain.mockResolvedValue({
			tag: "new_sending_apex",
			name: "example.com",
			enabled: true,
		});

		const result = await provisionDomainOnCloudflare(env, "example.com");

		expect(mocks.createSendingSubdomain).toHaveBeenCalledWith(env, "zone_1", "example.com");
		expect(result).toMatchObject({
			sendingEnabled: true,
			sendingSubdomainTag: "new_sending_apex",
		});
	});
});
