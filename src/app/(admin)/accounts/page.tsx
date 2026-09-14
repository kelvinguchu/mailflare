"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	PROFILE_AVATAR_ACCEPT,
	validateProfileAvatar,
} from "@/components/settings/profile-avatar-form-utils";
import { authFetch } from "@/lib/auth/client";
import { createUserAccountSchema } from "@/lib/validators";
import { useBranding } from "@/components/branding-provider";
import type { Account, AccountResponse, Domain } from "./types";

const LOCAL_PART_DISALLOWED = /[^a-z0-9._%+-]/g;

function toLocalPart(value: string): string {
	return value.toLowerCase().replace(/\s+/g, ".").replace(LOCAL_PART_DISALLOWED, "");
}

type AccountFieldErrors = Partial<Record<string, string>>;

const FIELD_MESSAGES: Record<string, string> = {
	username: "Enter a username using letters, numbers, or . _ % + -",
	domainId: "Choose a domain.",
	invitationEmail: "Enter a valid email address.",
	name: "Enter the person's name.",
	senderName: "Sender name must be 100 characters or fewer.",
};

function getActivationLabel(account: Account): string {
	if (account.activationStatus === "active") return "Active";
	if (account.activationStatus === "revoked") return "Invitation revoked";
	if (account.invitationExpired) return "Invitation expired";
	return account.invitationSentAt ? "Invitation pending" : "Invitation not sent";
}

export default function AccountsPage() {
	const branding = useBranding();
	const [accounts, setAccounts] = useState<Account[]>([]);
	const [domains, setDomains] = useState<Domain[]>([]);
	const [username, setUsername] = useState("");
	const [name, setName] = useState("");
	const [senderName, setSenderName] = useState("");
	const [domainId, setDomainId] = useState("");
	const [role, setRole] = useState<"admin" | "user">("user");
	const [invitationEmail, setInvitationEmail] = useState("");
	const [fieldErrors, setFieldErrors] = useState<AccountFieldErrors>({});
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
		loadAccounts()
			.then(async () => {
				const response = await authFetch("/api/domains");
				const data = (await response.json()) as { domains?: Domain[]; error?: string };
				if (!response.ok) throw new Error(data.error ?? "Unable to load domains");
				setDomains(data.domains ?? []);
				setDomainId(data.domains?.[0]?.id ?? "");
			})
			.catch((error) => {
				const text = error instanceof Error ? error.message : "Unable to load accounts";
				setMessage(text);
			})
			.finally(() => setLoading(false));
	}, []);

	function onUsernameChange(raw: string) {
		const at = raw.indexOf("@");
		if (at === -1) {
			setUsername(toLocalPart(raw));
			return;
		}

		const pastedDomain = raw
			.slice(at + 1)
			.trim()
			.toLowerCase();
		const match = domains.find((domain) => domain.hostname.toLowerCase() === pastedDomain);
		if (match) setDomainId(match.id);
		setUsername(toLocalPart(raw.slice(0, at)));
	}

	function clearFieldError(field: string) {
		setFieldErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
	}

	async function createAccount(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		if (avatar) {
			const avatarError = validateProfileAvatar(avatar);
			if (avatarError) {
				setMessage(avatarError);
				return;
			}
		}

		// Validated against the same schema the API uses, so the form can never
		// submit something the server will reject. It also covers the controls
		// that are no longer native inputs, where `required` does nothing.
		const parsed = createUserAccountSchema.safeParse({
			username: toLocalPart(username),
			name: name.trim(),
			senderName: senderName.trim() || undefined,
			domainId,
			invitationEmail: invitationEmail.trim(),
			role,
		});

		if (!parsed.success) {
			const errors: AccountFieldErrors = {};
			for (const issue of parsed.error.issues) {
				const field = String(issue.path[0] ?? "form");
				errors[field] ??= FIELD_MESSAGES[field] ?? issue.message;
			}
			setFieldErrors(errors);
			setMessage(null);
			return;
		}

		setFieldErrors({});
		setSaving(true);
		setMessage(null);
		try {
			const response = await authFetch("/api/accounts", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					username: toLocalPart(username),
					name,
					senderName: senderName.trim() || undefined,
					domainId,
					invitationEmail,
					role,
				}),
			});
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
					const avatarData = (await avatarResponse.json().catch(() => null)) as {
						error?: string;
					} | null;
					avatarUploadError = avatarData?.error ?? "Avatar upload failed";
				}
			}
			setUsername("");
			setName("");
			setSenderName("");
			setInvitationEmail("");
			setAvatar(null);
			setCreateOpen(false);
			await loadAccounts();
			if (avatarUploadError) {
				setMessage(`Account created, but its profile picture was not saved: ${avatarUploadError}`);
			} else if (data.invitationDelivery === "delivery_disabled") {
				setMessage(
					"Account created. Invitation delivery is disabled in this environment; resend it after enabling delivery.",
				);
			} else {
				setMessage("Account created and invitation scheduled.");
			}
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to create account");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between gap-4">
				<div>
					<h1 className="text-3xl font-medium text-neutral-900">Accounts</h1>
					<p className="mt-2 text-sm text-neutral-500">Manage accounts and their inboxes.</p>
				</div>
				<Button onClick={() => setCreateOpen(true)}>
					<Plus className="h-4 w-4" />
					New account
				</Button>
			</div>
			{message && !createOpen && (
				<p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
					{message}
				</p>
			)}
			<div className="relative">
				<div className="grid gap-3">
					{loading && <p className="text-sm text-neutral-500">Loading...</p>}
					{accounts.map((account) => (
						<Link
							key={account.id}
							href={`/accounts/${account.id}`}
							className="flex items-center gap-4 rounded-3xl bg-white p-5 transition-colors hover:bg-primary/5"
						>
							<span className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/12 font-semibold text-primary">
								{account.name.charAt(0).toUpperCase()}
								{account.hasAvatar && (
									<Image
										src={`/api/accounts/${account.id}/avatar`}
										alt=""
										fill
										sizes="48px"
										unoptimized
										className="object-cover"
									/>
								)}
							</span>
							<span className="min-w-0">
								<span className="flex flex-wrap items-center gap-2">
									<span className="truncate font-semibold text-neutral-900">{account.name}</span>
									<span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-medium capitalize text-neutral-600">
										{account.role}
									</span>
									<span
										className={`rounded-full px-2 py-0.5 text-xs font-medium ${account.activationStatus === "active" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
									>
										{getActivationLabel(account)}
									</span>
								</span>
								<span className="block truncate text-sm text-neutral-500">{account.email}</span>
							</span>
						</Link>
					))}
				</div>
			</div>
			<Dialog open={createOpen} onOpenChange={setCreateOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Add user account</DialogTitle>
						<DialogDescription>Sends an activation link to set a password.</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<form onSubmit={createAccount} noValidate className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="account-username">Email</Label>
								<InputGroup>
									<InputGroupInput
										id="account-username"
										value={username}
										onChange={(event) => {
											onUsernameChange(event.target.value);
											clearFieldError("username");
										}}
										placeholder="username"
										autoComplete="off"
										spellCheck={false}
										aria-invalid={!!fieldErrors.username}
									/>
									<InputGroupAddon align="inline-end">
										<Select
											value={domainId}
											onValueChange={(value) => {
												setDomainId(value as string);
												clearFieldError("domainId");
											}}
										>
											<SelectTrigger
												aria-label="Domain"
												aria-invalid={!!fieldErrors.domainId}
												size="sm"
												className="h-7 max-w-56 rounded-sm border-0 bg-transparent px-1.5 font-normal shadow-none hover:bg-muted hover:text-foreground focus-visible:ring-0"
											>
												<SelectValue>
													{(value) => {
														const match = domains.find((domain) => domain.id === value);
														return match ? `@${match.hostname}` : "Select domain";
													}}
												</SelectValue>
											</SelectTrigger>
											<SelectContent>
												{domains.map((domain) => (
													<SelectItem key={domain.id} value={domain.id}>
														@{domain.hostname}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</InputGroupAddon>
								</InputGroup>
								{fieldErrors.username && (
									<p className="text-xs text-destructive">{fieldErrors.username}</p>
								)}
								{fieldErrors.domainId && (
									<p className="text-xs text-destructive">{fieldErrors.domainId}</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="account-name">Person&apos;s name</Label>
								<Input
									id="account-name"
									value={name}
									onChange={(event) => {
										setName(event.target.value);
										clearFieldError("name");
									}}
									placeholder="John Doe"
									maxLength={100}
									aria-invalid={!!fieldErrors.name}
								/>
								{fieldErrors.name && <p className="text-xs text-destructive">{fieldErrors.name}</p>}
							</div>
							<div className="space-y-2">
								<Label htmlFor="account-sender-name">Sender name</Label>
								<Input
									id="account-sender-name"
									value={senderName}
									onChange={(event) => setSenderName(event.target.value)}
									placeholder={
										name.trim() && branding.companyName
											? `${name.trim()} from ${branding.companyName}`
											: name.trim() || "John Doe from CaliberCode"
									}
									maxLength={100}
								/>
								<p className="text-xs text-neutral-500">
									Defaults to the person and company names.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="account-avatar">Profile picture</Label>
								<Input
									id="account-avatar"
									type="file"
									accept={PROFILE_AVATAR_ACCEPT}
									onChange={(event) => {
										const picked = event.target.files?.[0] ?? null;
										setAvatar(picked);
										if (picked) setMessage(validateProfileAvatar(picked));
									}}
								/>
								<p className="text-xs text-neutral-500">Optional. Changeable later in settings.</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="account-invitation-email">Invitation email</Label>
								<Input
									id="account-invitation-email"
									type="email"
									autoComplete="email"
									value={invitationEmail}
									onChange={(event) => {
										setInvitationEmail(event.target.value);
										clearFieldError("invitationEmail");
									}}
									placeholder="person@example.com"
									aria-invalid={!!fieldErrors.invitationEmail}
								/>
								{fieldErrors.invitationEmail && (
									<p className="text-xs text-destructive">{fieldErrors.invitationEmail}</p>
								)}
								<p className="text-xs text-neutral-500">
									An external address, also used for recovery.
								</p>
							</div>
							<div className="space-y-2">
								<Label htmlFor="account-role">Role</Label>
								<Select value={role} onValueChange={(value) => setRole(value as "admin" | "user")}>
									<SelectTrigger id="account-role" className="w-full">
										<SelectValue>{(value) => (value === "admin" ? "Admin" : "User")}</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="user">User</SelectItem>
										<SelectItem value="admin">Admin</SelectItem>
									</SelectContent>
								</Select>
							</div>
							{message && <p className="text-sm text-red-600">{message}</p>}
							<Button type="submit" disabled={saving || !domainId}>
								{saving ? "Creating..." : "Create account"}
							</Button>
						</form>
					</DialogBody>
				</DialogContent>
			</Dialog>
		</div>
	);
}
