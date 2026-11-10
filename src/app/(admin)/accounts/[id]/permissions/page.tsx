"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { ManagedAccount } from "../types";
import { fetchManagedAccount, saveManagedAccount } from "../utils";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export default function AccountPermissionsPage() {
	const { id } = useParams<{ id: string }>();
	const [account, setAccount] = useState<ManagedAccount | null>(null);
	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState<string | null>(null);

	useEffect(() => {
		void fetchManagedAccount(id)
			.then(setAccount)
			.catch((error) =>
				setMessage(error instanceof Error ? error.message : "Unable to load permissions"),
			);
	}, [id]);

	async function savePermissions() {
		if (!account) return;
		setSaving(true);
		setMessage(null);
		try {
			await saveManagedAccount(account);
			setMessage("Permissions updated");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "Unable to update permissions");
		} finally {
			setSaving(false);
		}
	}

	const permissions = [
		{
			key: "admin",
			label: "Administrator access",
			description: "Access administration pages and manage workspace settings.",
			ariaLabel: "Allow administrator access",
			checked: account?.role === "admin",
			onChange: (checked: boolean) =>
				account && setAccount({ ...account, role: checked ? "admin" : "user" }),
		},
		{
			key: "mailboxes",
			label: "Manage mailboxes",
			description: "Allow this account to add and remove its own inboxes.",
			ariaLabel: "Allow mailbox management",
			checked: account?.canManageMailboxes ?? false,
			onChange: (checked: boolean) =>
				account && setAccount({ ...account, canManageMailboxes: checked }),
		},
	];

	return (
		<div className="space-y-6">
			<AdminPageHeader title={account?.name ?? "Account"} />
			<ul className="space-y-2 md:hidden">
				{permissions.map((permission) => (
					<li key={permission.key}>
						<label
							htmlFor={`permission-${permission.key}-card`}
							className="flex items-start gap-3 rounded-xl border bg-white p-3.5"
						>
							<span className="min-w-0 flex-1">
								<span className="block text-sm font-semibold text-neutral-900">
									{permission.label}
								</span>
								<span className="mt-1 block text-xs text-neutral-500">
									{permission.description}
								</span>
							</span>
							<Checkbox
								id={`permission-${permission.key}-card`}
								aria-label={permission.ariaLabel}
								checked={permission.checked}
								disabled={!account}
								onChange={(event) => permission.onChange(event.target.checked)}
								className="mt-0.5 shrink-0"
							/>
						</label>
					</li>
				))}
			</ul>
			<div className="hidden overflow-hidden rounded-3xl bg-white md:block">
				<table className="w-full text-left">
					<thead className="border-b border-neutral-100 bg-neutral-50 text-xs font-semibold uppercase tracking-wide text-neutral-500">
						<tr>
							<th className="px-5 py-3">Permission</th>
							<th className="w-28 px-5 py-3 text-center">Allowed</th>
						</tr>
					</thead>
					<tbody className="divide-y divide-neutral-100">
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-neutral-900">Administrator access</p>
								<p className="mt-1 text-xs text-neutral-500">
									Access administration pages and manage workspace settings.
								</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label="Allow administrator access"
									checked={account?.role === "admin"}
									disabled={!account}
									onChange={(event) =>
										account &&
										setAccount({ ...account, role: event.target.checked ? "admin" : "user" })
									}
								/>
							</td>
						</tr>
						<tr>
							<td className="px-5 py-4">
								<p className="text-sm font-semibold text-neutral-900">Manage mailboxes</p>
								<p className="mt-1 text-xs text-neutral-500">
									Allow this account to add and remove its own inboxes.
								</p>
							</td>
							<td className="px-5 py-4 text-center">
								<Checkbox
									aria-label="Allow mailbox management"
									checked={account?.canManageMailboxes ?? false}
									disabled={!account}
									onChange={(event) =>
										account && setAccount({ ...account, canManageMailboxes: event.target.checked })
									}
								/>
							</td>
						</tr>
					</tbody>
				</table>
			</div>
			<Button onClick={() => void savePermissions()} disabled={!account || saving}>
				{saving ? "Saving..." : "Save permissions"}
			</Button>
			{message && <p className="text-sm text-neutral-500">{message}</p>}
		</div>
	);
}
