"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { getMailboxAddress, updateCurrentMailboxName } from "./utils";

export function CurrentMailboxForm() {
	const { selectedMailbox, setSelectedMailbox, isLoading } = useSelectedMailbox();
	const [displayName, setDisplayName] = useState("");
	const [savedDisplayName, setSavedDisplayName] = useState("");
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		const nextName = selectedMailbox?.displayName ?? "";
		setDisplayName(nextName);
		setSavedDisplayName(nextName);
		setStatus(null);
	}, [selectedMailbox?.id, selectedMailbox?.displayName]);

	async function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedMailbox) return;

		setSaving(true);
		setStatus(null);
		try {
			const updated = await updateCurrentMailboxName(selectedMailbox.id, displayName);
			setSelectedMailbox(updated);
			setSavedDisplayName(updated.displayName ?? "");
			setDisplayName(updated.displayName ?? "");
			setStatus("Saved");
		} catch (err) {
			setStatus(err instanceof Error ? err.message : "Failed to update mailbox");
		} finally {
			setSaving(false);
		}
	}

	if (isLoading) {
		return (
			<Card className="rounded-3xl border-0 bg-white px-6">
				<CardHeader>
					<Skeleton className="h-6 w-36" />
					<Skeleton className="h-4 w-72" />
				</CardHeader>
				<CardContent className="space-y-4 pb-6">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-9 w-28" />
				</CardContent>
			</Card>
		);
	}

	if (!selectedMailbox) {
		return (
			<Card className="rounded-3xl border-0 bg-white px-6">
				<CardHeader>
					<CardTitle>Sender identity</CardTitle>
					<CardDescription>Select a mailbox to configure the name recipients see.</CardDescription>
				</CardHeader>
			</Card>
		);
	}

	const address = getMailboxAddress(selectedMailbox);
	const hasChanges = displayName.trim() !== savedDisplayName;
	const canManage = selectedMailbox.permission === "full_access";

	return (
		<Card className="rounded-3xl border-0 bg-white px-6">
			<CardHeader>
				<CardTitle>Sender identity</CardTitle>
				<CardDescription>
					Set the name recipients see beside {address}. This is separate from your account profile name.
				</CardDescription>
			</CardHeader>
			<CardContent className="pb-6">
				<form onSubmit={onSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="senderDisplayName">Sender name</Label>
						<Input
							id="senderDisplayName"
							value={displayName}
							onChange={(event) => setDisplayName(event.target.value)}
							placeholder={selectedMailbox.localPart}
							disabled={saving || !canManage}
						/>
						<p className="text-xs text-neutral-500">
							Preview: {displayName.trim() || selectedMailbox.localPart} &lt;{address}&gt;
						</p>
					</div>
					<div className="flex items-center gap-3">
						<Button type="submit" disabled={saving || !hasChanges || !canManage}>
							<Save className="h-4 w-4" />
							{saving ? "Saving..." : "Save sender name"}
						</Button>
						{status && <p className="text-sm text-neutral-500">{status}</p>}
					</div>
					{!canManage && (
						<p className="text-sm text-neutral-500">Only the mailbox owner can change this sender name.</p>
					)}
				</form>
			</CardContent>
		</Card>
	);
}
