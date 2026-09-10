"use client";

import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Policy = { id: string; userId: string | null; patternType: "address" | "domain"; pattern: string; action: "allow" | "block" };

export default function SenderPoliciesPage() {
	const [policies, setPolicies] = useState<Policy[]>([]);
	const [pattern, setPattern] = useState("");
	const [patternType, setPatternType] = useState<"address" | "domain">("address");
	const [action, setAction] = useState<"allow" | "block">("block");
	const [error, setError] = useState("");

	async function load() {
		const response = await authFetch("/api/admin/sender-policies");
		const data = await response.json() as { policies?: Policy[]; error?: string };
		if (!response.ok) throw new Error(data.error ?? "Unable to load policies");
		setPolicies(data.policies ?? []);
	}

	useEffect(() => { void load().catch((reason: Error) => setError(reason.message)); }, []);

	async function add() {
		setError("");
		const response = await authFetch("/api/admin/sender-policies", {
			method: "POST", headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ pattern, patternType, action, userId: null }),
		});
		const data = await response.json() as { error?: string };
		if (!response.ok) { setError(typeof data.error === "string" ? data.error : "Unable to save policy"); return; }
		setPattern("");
		await load();
	}

	async function remove(id: string) {
		await authFetch(`/api/admin/sender-policies?id=${encodeURIComponent(id)}`, { method: "DELETE" });
		await load();
	}

	return <div className="space-y-6">
		<div><h1 className="text-3xl font-medium">Sender policies</h1><p className="mt-1 text-sm text-neutral-500">Global allow and block policies are evaluated before inbound content is made available.</p></div>
		<section className="space-y-4 rounded-3xl bg-white p-6">
			<div className="grid gap-4 sm:grid-cols-3">
				<label className="space-y-2"><Label>Match</Label><select className="h-10 w-full rounded-md border border-neutral-200 px-3" value={patternType} onChange={(event) => setPatternType(event.target.value as "address" | "domain")}><option value="address">Email address</option><option value="domain">Domain</option></select></label>
				<label className="space-y-2"><Label>Action</Label><select className="h-10 w-full rounded-md border border-neutral-200 px-3" value={action} onChange={(event) => setAction(event.target.value as "allow" | "block")}><option value="block">Block and quarantine</option><option value="allow">Allow (spam signals only)</option></select></label>
				<label className="space-y-2"><Label>Address or domain</Label><Input value={pattern} onChange={(event) => setPattern(event.target.value)} placeholder={patternType === "address" ? "sender@example.com" : "example.com"} /></label>
			</div>
			<Button onClick={() => void add()} disabled={!pattern.trim()}>Add policy</Button>
			{error && <p className="text-sm text-red-600">{error}</p>}
		</section>
		<section className="space-y-2">{policies.map((policy) => <div key={policy.id} className="flex items-center justify-between rounded-2xl bg-white px-5 py-4 text-sm"><span><b className={policy.action === "block" ? "text-red-700" : "text-green-700"}>{policy.action}</b> · {policy.patternType} · {policy.pattern}</span><Button variant="outline" size="sm" onClick={() => void remove(policy.id)}>Remove</Button></div>)}</section>
	</div>;
}
