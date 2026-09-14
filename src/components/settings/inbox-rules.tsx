"use client";

import type { SubmitEvent, KeyboardEvent } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Folder, Plus, ShieldAlert, Trash2 } from "lucide-react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { InboxRule, InboxRuleInput } from "./inbox-rules-types";
import {
	createInboxRule,
	deleteInboxRule,
	fetchInboxRules,
	fetchRuleFolders,
	getInboxRuleDestination,
	getRuleFieldLabel,
	getRuleOperatorLabel,
	updateInboxRule,
} from "./inbox-rules-utils";

const MATCH_FIELD_LABELS = {
	email: "Email address",
	content: "Content",
	title: "Title",
};

export function InboxRules() {
	const queryClient = useQueryClient();
	const { selectedMailbox } = useSelectedMailbox();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingRule, setEditingRule] = useState<InboxRule | null>(null);
	const [matchField, setMatchField] = useState<"email" | "content" | "title">("email");
	const [matchOperator, setMatchOperator] = useState<"contains" | "exact">("contains");
	const [matchValue, setMatchValue] = useState("");
	const [destination, setDestination] = useState("");
	const mailboxId = selectedMailbox?.id ?? "";

	const folders = useQuery({
		queryKey: ["folders", mailboxId],
		enabled: !!mailboxId,
		queryFn: () => fetchRuleFolders(mailboxId),
	});
	const rules = useQuery({
		queryKey: ["routing-rules", mailboxId],
		enabled: !!mailboxId,
		queryFn: () => fetchInboxRules(mailboxId),
	});

	const save = useMutation({
		mutationFn: () => {
			const input: InboxRuleInput = {
				mailboxId,
				matchField,
				matchOperator,
				matchValue,
				destination,
				priority: editingRule?.priority ?? 10,
			};
			return editingRule ? updateInboxRule(editingRule.id, input) : createInboxRule(input);
		},
		onSuccess: () => {
			setDialogOpen(false);
			setEditingRule(null);
			void queryClient.invalidateQueries({ queryKey: ["routing-rules", mailboxId] });
		},
	});
	const remove = useMutation({
		mutationFn: deleteInboxRule,
		onSuccess: () => queryClient.invalidateQueries({ queryKey: ["routing-rules", mailboxId] }),
	});

	const folderMap = new Map(
		(folders.data?.folders ?? []).map((folder) => [folder.id, folder.name]),
	);

	function getRuleDestinationLabel(rule: Pick<InboxRule, "action" | "folderId">) {
		if (rule.action === "spam") return "Spam";
		if (rule.action === "trash") return "Trash";
		return folderMap.get(rule.folderId ?? "") ?? "Unknown folder";
	}

	function openCreateDialog() {
		setEditingRule(null);
		setMatchField("email");
		setMatchOperator("contains");
		setMatchValue("");
		setDestination("");
		save.reset();
		setDialogOpen(true);
	}

	function openEditDialog(rule: InboxRule) {
		setEditingRule(rule);
		setMatchField(rule.matchField);
		setMatchOperator(rule.matchOperator);
		setMatchValue(rule.matchValue || rule.pattern);
		setDestination(getInboxRuleDestination(rule));
		save.reset();
		setDialogOpen(true);
	}

	function onRuleKeyDown(event: KeyboardEvent<HTMLDivElement>, rule: InboxRule) {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		openEditDialog(rule);
	}

	function onSubmit(event: SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		save.mutate();
	}

	return (
		<section className="space-y-4">
			<div className="flex flex-row justify-end">
				<Button type="button" size="sm" onClick={openCreateDialog} disabled={!mailboxId}>
					<Plus className="h-4 w-4" />
					New rule
				</Button>
			</div>
			{(rules.data?.rules ?? []).length === 0 && (
				<p className="rounded-lg border border-dashed border-neutral-200 px-4 py-5 text-sm text-neutral-500">
					No rules yet
				</p>
			)}
			<div className="divide-y divide-neutral-100">
				{(rules.data?.rules ?? []).map((rule) => (
					<div
						key={rule.id}
						role="button"
						tabIndex={0}
						onClick={() => openEditDialog(rule)}
						onKeyDown={(event) => onRuleKeyDown(event, rule)}
						className="group -mx-3 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-3 outline-none transition-colors hover:bg-neutral-50 focus-visible:bg-neutral-50 focus-visible:ring-2 focus-visible:ring-primary/25"
					>
						<div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
							{rule.action === "spam" ? (
								<ShieldAlert className="h-4 w-4" />
							) : rule.action === "trash" ? (
								<Trash2 className="h-4 w-4" />
							) : (
								<Folder className="h-4 w-4" />
							)}
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate text-sm font-medium text-neutral-900">
								{getRuleFieldLabel(rule.matchField)} {getRuleOperatorLabel(rule.matchOperator)}{" "}
								{rule.matchValue || rule.pattern}
							</p>
							<p className="truncate text-xs text-neutral-500">{getRuleDestinationLabel(rule)}</p>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={remove.isPending}
							onClick={(event) => {
								event.stopPropagation();
								remove.mutate(rule.id);
							}}
							onKeyDown={(event) => event.stopPropagation()}
							className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
							aria-label="Delete rule"
						>
							<Trash2 className="h-4 w-4" />
						</Button>
					</div>
				))}
			</div>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{editingRule ? "Update rule" : "New rule"}</DialogTitle>
						<DialogDescription>
							Choose what to match and where the message should go.
						</DialogDescription>
					</DialogHeader>
					<DialogBody>
						<form onSubmit={onSubmit} className="space-y-4">
							<div className="grid gap-3 sm:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor="matchField">Field</Label>
									<Select
										value={matchField}
										onValueChange={(value) => setMatchField(value as "email" | "content" | "title")}
										items={MATCH_FIELD_LABELS}
									>
										<SelectTrigger id="matchField" className="w-full">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="email">Email address</SelectItem>
											<SelectItem value="content">Content</SelectItem>
											<SelectItem value="title">Title</SelectItem>
										</SelectContent>
									</Select>
								</div>
								<div className="space-y-2">
									<Label htmlFor="matchOperator">Match</Label>
									<Select
										value={matchOperator}
										onValueChange={(value) => setMatchOperator(value as "contains" | "exact")}
									>
										<SelectTrigger id="matchOperator" className="w-full">
											<SelectValue>
												{(value) => (value === "exact" ? "Exact match" : "Contains")}
											</SelectValue>
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="contains">Contains</SelectItem>
											<SelectItem value="exact">Exact match</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>
							<div className="space-y-2">
								<Label htmlFor="matchValue">Value</Label>
								<Input
									id="matchValue"
									value={matchValue}
									onChange={(event) => setMatchValue(event.target.value)}
									placeholder={matchField === "email" ? "sender@example.com" : "Invoice"}
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="destination">Destination</Label>
								<Select
									value={destination}
									onValueChange={(value) => setDestination(value as string)}
								>
									<SelectTrigger id="destination" className="w-full">
										<SelectValue>
											{(value) => {
												if (value === "spam") return "Spam";
												if (value === "trash") return "Trash";
												const folder = (folders.data?.folders ?? []).find(
													(item) => `folder:${item.id}` === value,
												);
												return folder ? folder.name : "Select destination";
											}}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="spam">Spam</SelectItem>
										<SelectItem value="trash">Trash</SelectItem>
										{(folders.data?.folders ?? []).map((folder) => (
											<SelectItem key={folder.id} value={`folder:${folder.id}`}>
												{folder.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							{save.isError && <p className="text-sm text-red-600">{save.error.message}</p>}
							<Button
								type="submit"
								disabled={!mailboxId || !destination || !matchValue.trim() || save.isPending}
							>
								{save.isPending ? "Saving..." : editingRule ? "Update rule" : "Add rule"}
							</Button>
						</form>
					</DialogBody>
				</DialogContent>
			</Dialog>
		</section>
	);
}
