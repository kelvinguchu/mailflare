import type { OperationalHealth, OperationalThresholds } from "@/lib/operations/types";

export type Tone = "neutral" | "good" | "warning" | "critical";

export type ThresholdField = {
	field: keyof OperationalThresholds;
	group: "Queues" | "Delivery" | "Background work" | "Backup and storage";
	label: string;
	unit: string;
	min: number;
	max: number;
	hint?: string;
	/** The value the threshold is compared with, for context beside the input. */
	current: (health: OperationalHealth) => number | null;
};

export type AlertLink =
	| { kind: "href"; href: string; label: string }
	| { kind: "measure"; label: string }
	| { kind: "anchor"; href: string; label: string };

export type DeliverySegment = {
	key: "delivered" | "accepted" | "suppressed" | "unknown" | "failed";
	label: string;
	count: number;
	percent: number;
	className: string;
};
