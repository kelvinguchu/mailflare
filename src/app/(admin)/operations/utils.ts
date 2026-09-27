import { authFetch } from "@/lib/auth/client";
import type {
	OperationalAlert,
	OperationalHealth,
	OperationalThresholds,
	QueueHealth,
} from "@/lib/operations/types";
import type { AlertLink, DeliverySegment, ThresholdField, Tone } from "./types";

export const OPERATIONS_QUERY_KEY = ["operational-health"] as const;
export const REFRESH_INTERVAL_MS = 30_000;

export class OperationsRequestError extends Error {
	readonly status: number;
	readonly code: string | null;

	constructor(message: string, status: number, code: string | null) {
		super(message);
		this.name = "OperationsRequestError";
		this.status = status;
		this.code = code;
	}
}

export function isRecentAuthenticationError(error: unknown): boolean {
	return error instanceof OperationsRequestError && error.code === "RECENT_AUTHENTICATION_REQUIRED";
}

/** Turns API failures into sentences an administrator can act on. */
export function describeOperationsError(error: unknown, action: string): string {
	if (error instanceof OperationsRequestError) {
		if (error.status === 403) {
			return `You don’t have permission to ${action}. Sign in again with an administrator account.`;
		}
		if (error.status === 428) return "Confirm your identity to continue.";
		if (error.status >= 500) return `Couldn’t ${action}. The server reported an error; try again.`;
		return error.message;
	}
	return `Couldn’t ${action}. Check your connection and try again.`;
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
	const response = await authFetch(input, { cache: "no-store", ...init });
	const body = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string };
	if (!response.ok) {
		throw new OperationsRequestError(
			body.error ?? "Operational health request failed",
			response.status,
			body.code ?? null,
		);
	}
	return body;
}

export function fetchOperationalHealth(): Promise<OperationalHealth> {
	return request<OperationalHealth>("/api/admin/operations");
}

export async function captureStorageSnapshot(): Promise<void> {
	await request("/api/admin/operations", { method: "POST" });
}

export async function saveOperationalThresholds(thresholds: OperationalThresholds): Promise<void> {
	await request("/api/admin/operations", {
		method: "PUT",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(thresholds),
	});
}

export async function confirmIdentity(currentPassword: string, code: string): Promise<void> {
	await request("/api/auth/reauthenticate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ currentPassword, code }),
	});
}

export function formatBytes(bytes: number | null): string {
	if (bytes === null) return "—";
	if (bytes < 1_024) return `${bytes} B`;
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let value = bytes / 1_024;
	let unit = units[0];
	for (let index = 1; index < units.length && value >= 1_024; index += 1) {
		value /= 1_024;
		unit = units[index];
	}
	return `${value.toFixed(value >= 10 ? 1 : 2)} ${unit}`;
}

export function formatCount(value: number | null): string {
	return value === null ? "—" : value.toLocaleString();
}

export function formatDateTime(value: string | null): string {
	return value
		? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
		: "Never";
}

const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatRelative(value: string | null, now = new Date()): string {
	if (!value) return "Never";
	const seconds = Math.round((new Date(value).getTime() - now.getTime()) / 1_000);
	if (Math.abs(seconds) < 45) return "just now";
	const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
		["year", 31_536_000],
		["month", 2_592_000],
		["week", 604_800],
		["day", 86_400],
		["hour", 3_600],
		["minute", 60],
	];
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
	}
	return relativeFormat.format(seconds, "second");
}

export function formatGrowth(value: number | null): string {
	if (value === null) return "No earlier measurement";
	return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

export function minutesSince(value: string | null, now = new Date()): number | null {
	if (!value) return null;
	return Math.max(0, Math.floor((now.getTime() - new Date(value).getTime()) / 60_000));
}

export function formatDuration(minutes: number | null): string {
	if (minutes === null) return "—";
	if (minutes < 1) return "under a minute";
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h ${minutes % 60} min`;
	return `${Math.floor(hours / 24)} days`;
}

/** How a count compares with its alert threshold. */
export function toneForThreshold(
	value: number | null,
	threshold: number,
	severity: "warning" | "critical",
): Tone {
	if (value === null) return "neutral";
	if (value >= threshold) return severity;
	return "neutral";
}

export function queueTone(
	queue: QueueHealth,
	thresholds: OperationalThresholds,
	now = new Date(),
): Tone {
	if (!queue.available) return "warning";
	const age = minutesSince(queue.oldestMessageAt, now);
	if (age !== null && age >= thresholds.queueOldestMinutesWarning) return "critical";
	if ((queue.backlogCount ?? 0) >= thresholds.queueBacklogWarning) return "warning";
	return "good";
}

export function alertCounts(alerts: OperationalAlert[]) {
	return {
		critical: alerts.filter((alert) => alert.severity === "critical").length,
		warning: alerts.filter((alert) => alert.severity === "warning").length,
	};
}

/** Where an administrator goes to resolve an alert. */
export function getAlertLink(code: string): AlertLink | null {
	if (code === "BACKUP_STALE") return { kind: "href", href: "/backups", label: "Open backups" };
	if (code === "DEAD_LETTERS_UNRESOLVED" || code.startsWith("DELIVERY_")) {
		return { kind: "href", href: "/delivery-failures", label: "Review failures" };
	}
	if (code === "WEBHOOK_FAILED") return { kind: "href", href: "/webhooks", label: "Open webhooks" };
	if (code === "STORAGE_SNAPSHOT_MISSING" || code === "R2_SCAN_INCOMPLETE") {
		return { kind: "measure", label: "Measure storage" };
	}
	if (code.startsWith("QUEUE_")) return { kind: "anchor", href: "#queues", label: "View queues" };
	if (code.endsWith("_GROWTH")) return { kind: "anchor", href: "#storage", label: "View storage" };
	return null;
}

/** Outbound mail from the last 24 hours split by its current delivery state. */
export function getDeliverySegments(health: OperationalHealth): DeliverySegment[] {
	const { delivery } = health;
	const parts: Array<Omit<DeliverySegment, "percent">> = [
		{
			key: "delivered",
			label: "Delivered",
			count: delivery.delivered24h,
			className: "bg-emerald-500",
		},
		{
			key: "accepted",
			label: "Accepted, awaiting result",
			count: delivery.accepted24h,
			className: "bg-sky-400",
		},
		{
			key: "suppressed",
			label: "Suppressed",
			count: delivery.suppressed24h,
			className: "bg-neutral-400",
		},
		{
			key: "unknown",
			label: "Unknown outcome",
			count: delivery.unknown24h,
			className: "bg-amber-400",
		},
		{ key: "failed", label: "Failed", count: delivery.failed24h, className: "bg-red-500" },
	];
	const total = parts.reduce((sum, part) => sum + part.count, 0);
	return parts.map((part) => ({ ...part, percent: total ? (part.count / total) * 100 : 0 }));
}

/** Share of finished outbound mail that was delivered, or null with nothing finished. */
export function getDeliveryRate(health: OperationalHealth): number | null {
	const { delivered24h, failed24h, suppressed24h, unknown24h } = health.delivery;
	const finished = delivered24h + failed24h + suppressed24h + unknown24h;
	return finished ? (delivered24h / finished) * 100 : null;
}

export function getTotalBacklog(health: OperationalHealth): number | null {
	const available = health.queues.filter((queue) => queue.available);
	if (available.length === 0) return null;
	return available.reduce((sum, queue) => sum + (queue.backlogCount ?? 0), 0);
}

export function getOldestQueueMinutes(health: OperationalHealth, now = new Date()): number | null {
	const ages = health.queues
		.map((queue) => minutesSince(queue.oldestMessageAt, now))
		.filter((age): age is number => age !== null);
	return ages.length ? Math.max(...ages) : null;
}

export const THRESHOLD_FIELDS: ThresholdField[] = [
	{
		field: "queueBacklogWarning",
		group: "Queues",
		label: "Messages waiting in one queue",
		unit: "messages",
		min: 1,
		max: 1_000_000,
		current: (health) =>
			health.queues.reduce<number | null>(
				(largest, queue) =>
					queue.backlogCount === null ? largest : Math.max(largest ?? 0, queue.backlogCount),
				null,
			),
	},
	{
		field: "queueOldestMinutesWarning",
		group: "Queues",
		label: "Age of the oldest queued message",
		unit: "minutes",
		min: 1,
		max: 10_080,
		current: (health) => getOldestQueueMinutes(health),
	},
	{
		field: "deliveryFailed24hWarning",
		group: "Delivery",
		label: "Failed deliveries in 24 hours",
		unit: "messages",
		min: 1,
		max: 1_000_000,
		current: (health) => health.delivery.failed24h,
	},
	{
		field: "deliveryUnknown24hWarning",
		group: "Delivery",
		label: "Unknown delivery outcomes in 24 hours",
		unit: "messages",
		min: 1,
		max: 1_000_000,
		current: (health) => health.delivery.unknown24h,
	},
	{
		field: "deadLetterUnresolvedWarning",
		group: "Delivery",
		label: "Unresolved dead letters",
		unit: "events",
		min: 1,
		max: 1_000_000,
		current: (health) => health.deadLetters.unresolved,
	},
	{
		field: "webhookFailed24hWarning",
		group: "Background work",
		label: "Failed webhook deliveries in 24 hours",
		unit: "deliveries",
		min: 1,
		max: 1_000_000,
		current: (health) => health.webhooks.failed24h,
	},
	{
		field: "reminderFailed24hWarning",
		group: "Background work",
		label: "Failed reminders in 24 hours",
		unit: "reminders",
		min: 1,
		max: 1_000_000,
		current: (health) => health.reminders.failed24h,
	},
	{
		field: "backupStaleHours",
		group: "Backup and storage",
		label: "Backup is stale after",
		unit: "hours",
		min: 0,
		max: 8_760,
		hint: "0 follows the backup schedule.",
		current: (health) => {
			const minutes = minutesSince(health.backup.lastSuccessfulAt);
			return minutes === null ? null : Math.floor(minutes / 60);
		},
	},
	{
		field: "d1GrowthPercentWarning",
		group: "Backup and storage",
		label: "D1 growth between measurements",
		unit: "%",
		min: 1,
		max: 10_000,
		current: (health) => health.storage.growth?.d1Percent ?? null,
	},
	{
		field: "r2GrowthPercentWarning",
		group: "Backup and storage",
		label: "R2 growth between measurements",
		unit: "%",
		min: 1,
		max: 10_000,
		current: (health) => health.storage.growth?.r2Percent ?? null,
	},
];

/** Returns a message for each out-of-range threshold, keyed by field. */
export function validateThresholds(
	thresholds: OperationalThresholds,
): Partial<Record<keyof OperationalThresholds, string>> {
	const errors: Partial<Record<keyof OperationalThresholds, string>> = {};
	for (const field of THRESHOLD_FIELDS) {
		const value = thresholds[field.field];
		if (!Number.isInteger(value) || value < field.min || value > field.max) {
			errors[field.field] =
				`Enter a whole number from ${field.min.toLocaleString()} to ${field.max.toLocaleString()}.`;
		}
	}
	return errors;
}

export function thresholdsEqual(a: OperationalThresholds, b: OperationalThresholds): boolean {
	return THRESHOLD_FIELDS.every(({ field }) => a[field] === b[field]);
}
