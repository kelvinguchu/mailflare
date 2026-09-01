"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ManagedAccount, ManagedMailbox } from "./types";
import {
	fetchManagedAccount,
	fetchManagedMailboxes,
	saveManagedAccount,
	uploadManagedAccountAvatar,
	updateManagedMailboxName,
} from "./utils";

export default function AccountDetailsPage() {
	const { id } = useParams<{ id: string }>();
	const [account, setAccount] = useState<ManagedAccount | null>(null);
	const [mailboxes, setMailboxes] = useState<ManagedMailbox[]>([]);
	const [saving, setSaving] = useState(false);
	const [savingMailboxId, setSavingMailboxId] = useState<string | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const [avatarVersion, setAvatarVersion] = useState(0);

	useEffect(() => {
		void Promise.all([fetchManagedAccount(id), fetchManagedMailboxes(id)])
			.then(([nextAccount, nextMailboxes]) => {
				setAccount(nextAccount);
				setMailboxes(nextMailboxes);
			})
			.catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load account"));
	}, [id]);

	async function saveDetails() {
		if (!account) return;
		setSaving(true);
		setMessage(null);
		try {
			await saveManagedAccount(account);
			setMessage("Account details updated");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to update account");
		} finally {
			setSaving(false);
		}
	}

	async function uploadAvatar(file: File | undefined) {
		if (!file || !account) return;
		try {
			await uploadManagedAccountAvatar(account.id, file);
			setAccount({ ...account, hasAvatar: true });
			setAvatarVersion(Date.now());
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to update avatar");
		}
	}

	async function saveSenderName(mailbox: ManagedMailbox) {
		setSavingMailboxId(mailbox.id);
		setMessage(null);
		try {
			await updateManagedMailboxName(mailbox.id, mailbox.displayName?.trim() || mailbox.localPart);
			setMessage(`Sender name updated for ${mailbox.localPart}@${mailbox.hostname}`);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to update sender name");
		} finally {
			setSavingMailboxId(null);
		}
	}

	if (!account) return <p className="text-sm text-neutral-500">{message ?? "Loading account..."}</p>;

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-3xl font-medium text-neutral-900">Details</h1>
				<p className="mt-2 text-sm text-neutral-500">Update this account&apos;s profile and status.</p>
			</div>
			<section className="space-y-5 rounded-3xl bg-white p-6">
				<div className="flex items-center gap-4">
					<span className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-xl font-semibold text-blue-700">
						{account.name.charAt(0).toUpperCase()}
						{account.hasAvatar && (
							<img src={`/api/accounts/${id}/avatar?v=${avatarVersion}`} alt="" className="absolute inset-0 h-full w-full object-cover" />
						)}
					</span>
					<Label className="cursor-pointer">
						<span className="inline-flex h-9 items-center gap-2 rounded-md border border-neutral-200 px-3 text-sm">
							<Upload className="h-4 w-4" />
							Change avatar
						</span>
						<Input type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" onChange={(event) => void uploadAvatar(event.target.files?.[0])} />
					</Label>
				</div>
				<div className="space-y-2">
					<Label htmlFor="account-email">Email</Label>
					<Input id="account-email" value={account.email} readOnly className="bg-neutral-50 text-neutral-500" />
				</div>
				<div className="space-y-2">
					<Label htmlFor="account-name">Name</Label>
					<Input id="account-name" value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} />
				</div>
				<div className="space-y-2">
					<Label htmlFor="forwarding-email">Forwarding email (optional)</Label>
					<Input
						id="forwarding-email"
						type="email"
						value={account.forwardingEmail ?? ""}
						onChange={(event) => setAccount({ ...account, forwardingEmail: event.target.value || null })}
						placeholder="destination@example.com"
					/>
					<p className="text-xs leading-5 text-neutral-500">
						Incoming mail will also be sent to this verified Cloudflare Email Routing destination.
					</p>
				</div>
				<label className="flex items-center gap-3 text-sm">
					<Checkbox checked={!account.disabled} onChange={(event) => setAccount({ ...account, disabled: !event.target.checked })} />
					Account enabled
				</label>
				<Button onClick={() => void saveDetails()} disabled={saving || !account.name.trim()}>
					{saving ? "Saving..." : "Save details"}
				</Button>
			</section>
			<section className="space-y-5 rounded-3xl bg-white p-6">
				<div>
					<h2 className="text-lg font-semibold text-neutral-900">Sender identities</h2>
					<p className="mt-1 text-sm text-neutral-500">Only administrators can change the names recipients see.</p>
				</div>
				{mailboxes.length === 0 && <p className="text-sm text-neutral-500">No mailboxes are assigned to this account.</p>}
				{mailboxes.map((mailbox) => {
					const address = `${mailbox.localPart}@${mailbox.hostname}`;
					return (
						<div key={mailbox.id} className="space-y-3 rounded-2xl border border-neutral-100 p-4">
							<div className="space-y-2">
								<Label htmlFor={`sender-name-${mailbox.id}`}>Sender name for {address}</Label>
								<Input
									id={`sender-name-${mailbox.id}`}
									value={mailbox.displayName ?? ""}
									onChange={(event) => setMailboxes((items) => items.map((item) => item.id === mailbox.id ? { ...item, displayName: event.target.value } : item))}
									maxLength={100}
								/>
								<p className="text-xs text-neutral-500">Preview: {mailbox.displayName?.trim() || mailbox.localPart} &lt;{address}&gt;</p>
							</div>
							<Button type="button" onClick={() => void saveSenderName(mailbox)} disabled={savingMailboxId === mailbox.id}>
								{savingMailboxId === mailbox.id ? "Saving..." : "Save sender name"}
							</Button>
						</div>
					);
				})}
			</section>
			{message && <p className="text-sm text-neutral-500">{message}</p>}
		</div>
	);
}
