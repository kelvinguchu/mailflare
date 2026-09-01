"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
	PROFILE_AVATAR_ACCEPT,
	validateProfileAvatar,
} from "@/components/settings/profile-avatar-form-utils";
import { authFetch } from "@/lib/auth/client";
import { useBranding } from "@/components/branding-provider";
import type { Account, AccountResponse, Domain } from "./types";

export default function AccountsPage() {
	const branding = useBranding();
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [domains, setDomains] = useState<Domain[]>([]);
	const [username, setUsername] = useState("");
	const [name, setName] = useState("");
	const [senderName, setSenderName] = useState("");
	const [domainId, setDomainId] = useState("");
	const [role, setRole] = useState<"admin" | "user">("user");
	const [password, setPassword] = useState("");
	const [avatar, setAvatar] = useState<File | null>(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	async function loadAccounts() {
		const response = await authFetch("/api/accounts");
		const data = (await response.json()) as AccountResponse;
		if (!response.ok) throw new Error(data.error ?? "Unable to load accounts");
		setAccounts(data.accounts ?? []);
	}

	useEffect(() => {
		loadAccounts().then(async () => {
			const response = await authFetch("/api/domains");
			const data = (await response.json()) as { domains?: Domain[]; error?: string };
			if (!response.ok) throw new Error(data.error ?? "Unable to load domains");
			setDomains(data.domains ?? []);
			setDomainId(data.domains?.[0]?.id ?? "");
		}).catch((error) => {
			const text = error instanceof Error ? error.message : "Unable to load accounts";
			setMessage(text);
		}).finally(() => setLoading(false));
	}, []);

	async function createAccount(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (avatar) {
			const avatarError = validateProfileAvatar(avatar);
			if (avatarError) {
				setMessage(avatarError);
				return;
			}
		}
		setSaving(true);
		setMessage(null);
		try {
			const response = await authFetch("/api/accounts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, name, senderName: senderName.trim() || undefined, domainId, password, role }) });
			const data = (await response.json()) as AccountResponse;
			if (!response.ok) throw new Error(data.error ?? "Unable to create account");
			let avatarUploadError: string | null = null;
			if (avatar && data.account?.id) {
				const form = new FormData();
				form.set("file", avatar, avatar.name);
				const avatarResponse = await authFetch(`/api/accounts/${data.account.id}/avatar`, {
					method: "POST",
					body: form,
				});
				if (!avatarResponse.ok) {
					const avatarData = (await avatarResponse.json().catch(() => null)) as { error?: string } | null;
					avatarUploadError = avatarData?.error ?? "Avatar upload failed";
				}
			}
			setUsername("");
			setName("");
			setSenderName("");
			setPassword("");
			setAvatar(null);
			setCreateOpen(false);
			await loadAccounts();
			if (avatarUploadError) {
				setMessage(`Account created, but its profile picture was not saved: ${avatarUploadError}`);
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to create account");
		} finally {
			setSaving(false);
		}
	}

	return <div className="space-y-6">
		<div className="flex items-center justify-between gap-4"><div><h1 className="text-3xl font-medium text-neutral-900">Accounts</h1><p className="mt-2 text-sm text-neutral-500">Manage accounts and their inboxes.</p></div><Button onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" />New account</Button></div>
		{message && !createOpen && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</p>}
		<div className="relative"><div className="grid gap-3">
			{loading && <p className="text-sm text-neutral-500">Loading...</p>}
			{accounts.map((account) => <Link key={account.id} href={`/accounts/${account.id}`} className="flex items-center gap-4 rounded-3xl bg-white p-5 transition-colors hover:bg-blue-50/40"><span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 font-semibold text-blue-700">{account.name.charAt(0).toUpperCase()}{account.hasAvatar && <img src={`/api/accounts/${account.id}/avatar`} alt="" className="absolute inset-0 h-full w-full object-cover" />}</span><span className="min-w-0"><span className="flex items-center gap-2"><span className="truncate font-semibold text-neutral-900">{account.name}</span><span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-600">{account.role}</span></span><span className="block truncate text-sm text-neutral-500">{account.email}</span></span></Link>)}
		</div></div>
		<Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent><DialogHeader><DialogTitle>Add user account</DialogTitle><DialogDescription>The user can sign in with this email and password.</DialogDescription></DialogHeader><form onSubmit={createAccount} className="space-y-4">
			<div className="space-y-2"><Label htmlFor="account-username">Email</Label><div className="flex h-10 overflow-hidden rounded-md border border-neutral-200 bg-white"><Input id="account-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="username" className="min-w-0 flex-1 rounded-none border-0 shadow-none" required /><span className="flex items-center text-sm text-neutral-400">@</span><Select aria-label="Domain" value={domainId} onChange={(event) => setDomainId(event.target.value)} className="max-w-[55%] bg-transparent px-3 text-sm" required><option value="">Select domain</option>{domains.map((domain) => <option key={domain.id} value={domain.id}>{domain.hostname}</option>)}</Select></div></div>
			<div className="space-y-2"><Label htmlFor="account-name">Person&apos;s name</Label><Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Sharon" maxLength={100} required /></div>
			<div className="space-y-2"><Label htmlFor="account-sender-name">Sender name</Label><Input id="account-sender-name" value={senderName} onChange={(event) => setSenderName(event.target.value)} placeholder={name.trim() && branding.companyName ? `${name.trim()} from ${branding.companyName}` : name.trim() || "Sharon from CaliberCode"} maxLength={100} /><p className="text-xs text-neutral-500">Optional override. If blank, CC Mail combines the person and company names.</p></div>
			<div className="space-y-2"><Label htmlFor="account-avatar">Profile picture</Label><Input id="account-avatar" type="file" accept={PROFILE_AVATAR_ACCEPT} onChange={(event) => { const picked = event.target.files?.[0] ?? null; setAvatar(picked); if (picked) setMessage(validateProfileAvatar(picked)); }} /><p className="text-xs text-neutral-500">Optional. The user can change this later in Account settings.</p></div>
			<div className="space-y-2"><Label htmlFor="account-password">Temporary password</Label><Input id="account-password" type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></div>
			<div className="space-y-2"><Label htmlFor="account-role">Role</Label><Select id="account-role" value={role} onChange={(event) => setRole(event.target.value as "admin" | "user")} className="h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm"><option value="user">User</option><option value="admin">Admin</option></Select></div>
			{message && <p className="text-sm text-red-600">{message}</p>}<Button type="submit" disabled={saving || !domainId}>{saving ? "Creating..." : "Create account"}</Button>
		</form></DialogContent></Dialog>
	</div>;
}
