import type { CfDnsRecord } from "@/lib/cloudflare-api";

export type DnsStatusSummary = {
	routing: {
		configured: boolean;
		missing: string[];
	};
	sending: {
		configured: boolean;
		records: string[];
	};
	authentication: {
		spf: boolean;
		dkim: boolean;
		dmarc: boolean;
	};
	warnings: string[];
};

export function summariseDns(
	routingRecords: CfDnsRecord[],
	routingMissing: CfDnsRecord[],
	sendingRecords: CfDnsRecord[],
	zoneRecords: CfDnsRecord[] = [],
	hostname = "",
): DnsStatusSummary {
	const recordTypes = (
		type: "routing-records" | "routing-missing" | "sending",
	) => {
		const list =
			type === "routing-records"
				? routingRecords
				: type === "routing-missing"
					? routingMissing
					: sendingRecords;
		return Array.from(new Set(list.map((r) => r.type).filter(Boolean))) as string[];
	};

	const normalizeName = (value: string | undefined) => (value ?? "").toLowerCase().replace(/\.$/, "");
	const relevantZoneRecords = zoneRecords.filter((record) => normalizeName(record.name) === hostname.toLowerCase());
	const allSendingRecords = [...sendingRecords, ...relevantZoneRecords];
	const hasContent = (predicate: (value: string) => boolean) => allSendingRecords.some((record) => predicate(record.content?.toLowerCase() ?? ""));
	const spf = hasContent((value) => value.startsWith("v=spf1"));
	const dkim = [...sendingRecords, ...zoneRecords].some((record) => normalizeName(record.name).includes("._domainkey"));
	const dmarcName = `_dmarc.${hostname}`.toLowerCase();
	const dmarc = zoneRecords.some((record) => normalizeName(record.name) === dmarcName && (record.content?.toLowerCase() ?? "").startsWith("v=dmarc1"));
	const warnings: string[] = [];
	if (routingMissing.length > 0 || routingRecords.length === 0) warnings.push("Repair the missing Email Routing MX/TXT records in Cloudflare DNS.");
	if (sendingRecords.length === 0) warnings.push("Enable Email Sending and publish the provider records before sending.");
	if (!spf) warnings.push("Publish the SPF TXT record supplied by Email Sending.");
	if (!dkim) warnings.push("Publish the DKIM record supplied by Email Sending.");
	if (!dmarc) warnings.push(`Publish a DMARC TXT record at _dmarc.${hostname}; begin with p=none while monitoring.`);
	return {
		routing: {
			configured: routingMissing.length === 0 && routingRecords.length > 0,
			missing: recordTypes("routing-missing"),
		},
		sending: {
			configured: sendingRecords.length > 0,
			records: recordTypes("sending"),
		},
		authentication: { spf, dkim, dmarc },
		warnings,
	};
}
