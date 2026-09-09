"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authFetch } from "@/lib/auth/client";

type WebhookDelivery = {
	id: string;
	eventType: string;
	status: string;
	attempts: number;
	lastStatusCode: number | null;
	lastError: string | null;
	createdAt: string;
};

export default function WebhooksPage() {
	const qc = useQueryClient();
	const [url, setUrl] = useState("");
	const [secret, setSecret] = useState<string | null>(null);
	const [selectedWebhookId, setSelectedWebhookId] = useState<string | null>(null);

	const { data } = useQuery({
		queryKey: ["webhooks"],
		queryFn: async () => {
			const res = await authFetch("/api/webhooks");
			return (await res.json()) as { webhooks: { id: string; url: string }[] };
		},
	});
	const activeWebhookId = selectedWebhookId ?? data?.webhooks[0]?.id ?? null;
	const { data: deliveryData } = useQuery({
		queryKey: ["webhook-deliveries", activeWebhookId],
		enabled: !!activeWebhookId,
		queryFn: async () => {
			const res = await authFetch(`/api/webhooks/${encodeURIComponent(activeWebhookId!)}/deliveries`);
			if (!res.ok) throw new Error("Failed to load webhook deliveries");
			return (await res.json()) as { deliveries: WebhookDelivery[] };
		},
	});

	const create = useMutation({
		mutationFn: async () => {
			const res = await authFetch("/api/webhooks", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					url,
					events: ["message.inbound", "message.outbound", "message.failed"],
				}),
			});
			const json = (await res.json()) as { secret?: string };
			if (!res.ok) throw new Error("Failed");
			setSecret(json.secret ?? null);
			setUrl("");
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["webhooks"] }),
	});
	const redeliver = useMutation({
		mutationFn: async (deliveryId: string) => {
			if (!activeWebhookId) throw new Error("No webhook selected");
			const res = await authFetch(
				`/api/webhooks/${encodeURIComponent(activeWebhookId)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
				{ method: "POST" },
			);
			if (!res.ok) throw new Error("Failed to queue webhook redelivery");
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: ["webhook-deliveries", activeWebhookId] }),
	});

	return (
		<div className="space-y-6 max-w-3xl">
			<h1 className="text-2xl font-semibold">Webhooks</h1>
			{secret && (
				<Card>
					<CardContent className="pt-6 text-sm">
						<p>Signing secret:</p>
						<code className="block mt-1 text-xs break-all">{secret}</code>
					</CardContent>
				</Card>
			)}
			<Card>
				<CardHeader>
					<CardTitle>Add webhook</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div className="space-y-2">
						<Label>URL</Label>
						<Input value={url} onChange={(e) => setUrl(e.target.value)} />
					</div>
					<Button onClick={() => create.mutate()} disabled={!url || create.isPending}>
						Add
					</Button>
				</CardContent>
			</Card>
			<Card>
				<CardHeader>
					<CardTitle>Endpoints</CardTitle>
				</CardHeader>
				<CardContent className="text-sm no-font-mono space-y-2">
					{(data?.webhooks ?? []).map((w) => (
						<button
							key={w.id}
							type="button"
							onClick={() => setSelectedWebhookId(w.id)}
							className={`block w-full rounded-md border px-3 py-2 text-left hover:bg-muted ${
								activeWebhookId === w.id ? "border-primary" : "border-border"
							}`}
						>
							<span className="block truncate">{w.url}</span>
						</button>
					))}
				</CardContent>
			</Card>
			{activeWebhookId && (
				<Card>
					<CardHeader>
						<CardTitle>Delivery history</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{(deliveryData?.deliveries ?? []).length === 0 && (
							<p className="text-sm text-muted-foreground">No deliveries yet.</p>
						)}
						{(deliveryData?.deliveries ?? []).map((delivery) => (
							<div key={delivery.id} className="flex items-center justify-between gap-4 rounded-md border p-3">
								<div className="min-w-0 text-sm">
									<p className="truncate font-medium">{delivery.eventType}</p>
									<p className="text-xs text-muted-foreground">
										{delivery.status} · {delivery.attempts} attempt{delivery.attempts === 1 ? "" : "s"}
										{delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ""}
									</p>
									<p className="text-xs text-muted-foreground">
										{new Date(delivery.createdAt).toLocaleString()}
										{delivery.lastError ? ` · ${delivery.lastError}` : ""}
									</p>
								</div>
								<Button
									variant="outline"
									size="sm"
									onClick={() => redeliver.mutate(delivery.id)}
									disabled={redeliver.isPending}
								>
									Redeliver
								</Button>
							</div>
						))}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
