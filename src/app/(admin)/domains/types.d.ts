export type Domain = {
	id: string;
	hostname: string;
	status: string;
	routingEnabled: boolean;
	sendingEnabled: boolean;
	sendRateLimitPerMinute: number;
	dailySendLimit: number;
	zoneId: string;
};

export type DnsRecord = {
	type?: string;
	name?: string;
	content?: string;
	priority?: number;
};

export type DnsStatusSummary = {
	routing: { configured: boolean; missing: string[] };
	sending: { configured: boolean; records: string[] };
	authentication: { spf: boolean; dkim: boolean; dmarc: boolean };
	warnings: string[];
};
