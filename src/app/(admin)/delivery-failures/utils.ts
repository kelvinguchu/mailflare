import { authFetch } from "@/lib/auth/client";
import type { DeliveryFailuresResponse } from "./types";

export async function fetchDeliveryFailures(limit = 100): Promise<DeliveryFailuresResponse> {
	const response = await authFetch(`/api/admin/dead-letters?limit=${limit}`);
	const data = (await response.json()) as DeliveryFailuresResponse & { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Failed to load delivery failures");
	return data;
}

export async function replayDeliveryFailure(id: string): Promise<void> {
	const response = await authFetch(`/api/admin/dead-letters/${id}/replay`, { method: "POST" });
	const data = (await response.json()) as { error?: string };
	if (!response.ok) throw new Error(data.error ?? "Failed to replay delivery failure");
}

export function formatFailureDate(value: string | null): string {
	if (!value) return "—";
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

export function formatDiagnosticCode(value: string): string {
	return value.toLowerCase().replaceAll("_", " ");
}
