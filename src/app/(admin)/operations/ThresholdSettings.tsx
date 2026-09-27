"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/toast";
import type { OperationalHealth, OperationalThresholds } from "@/lib/operations/types";
import { cn } from "@/lib/utils";
import type { ThresholdField } from "./types";
import {
	OPERATIONS_QUERY_KEY,
	THRESHOLD_FIELDS,
	confirmIdentity,
	describeOperationsError,
	isRecentAuthenticationError,
	saveOperationalThresholds,
	thresholdsEqual,
	validateThresholds,
} from "./utils";

const GROUPS = [...new Set(THRESHOLD_FIELDS.map((field) => field.group))];

function formatCurrent(field: ThresholdField, value: number | null): string {
	if (value === null) return "—";
	if (field.unit === "%") return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
	return `${value.toLocaleString()} ${field.unit}`;
}

function isOverThreshold(field: ThresholdField, value: number | null, threshold: number): boolean {
	if (value === null) return false;
	// A stale-after value of 0 follows the backup schedule, which the status banner already reflects.
	if (field.field === "backupStaleHours" && threshold === 0) return false;
	return value >= threshold;
}

export function ThresholdSettings({
	health,
	mfaEnabled,
}: Readonly<{ health: OperationalHealth; mfaEnabled: boolean }>) {
	const queryClient = useQueryClient();
	const saved = health.thresholds;
	const [draft, setDraft] = useState<OperationalThresholds>(saved);
	const [open, setOpen] = useState(false);
	const [needsIdentity, setNeedsIdentity] = useState(false);
	const [password, setPassword] = useState("");
	const [code, setCode] = useState("");
	const dirty = !thresholdsEqual(draft, saved);
	const errors = validateThresholds(draft);
	const hasErrors = Object.keys(errors).length > 0;

	useEffect(() => {
		// Refreshes every 30 seconds must not overwrite values being edited.
		if (!dirty) setDraft(saved);
	}, [dirty, saved]);

	const save = useMutation({
		mutationFn: async () => {
			if (needsIdentity) await confirmIdentity(password, code);
			await saveOperationalThresholds(draft);
		},
		onSuccess: async () => {
			setNeedsIdentity(false);
			setPassword("");
			setCode("");
			await queryClient.invalidateQueries({ queryKey: OPERATIONS_QUERY_KEY });
			toast.add({ title: "Alert thresholds saved", type: "success" });
		},
		onError: (error) => {
			if (isRecentAuthenticationError(error)) setNeedsIdentity(true);
		},
	});

	let submitLabel = needsIdentity ? "Confirm and save" : "Save thresholds";
	if (save.isPending) submitLabel = "Saving…";
	const saveError =
		save.error && !isRecentAuthenticationError(save.error)
			? describeOperationsError(save.error, "save the thresholds")
			: null;

	return (
		<Collapsible open={open} onOpenChange={setOpen}>
			<section className="rounded-2xl bg-white" aria-labelledby="thresholds-heading">
				<CollapsibleTrigger className="flex w-full items-center justify-between gap-4 rounded-2xl px-5 py-4 text-left outline-none hover:bg-neutral-50/70 focus-visible:ring-2 focus-visible:ring-primary/30">
					<span className="min-w-0">
						<span
							id="thresholds-heading"
							className="block text-[15px] font-medium text-neutral-900"
						>
							Alert thresholds
						</span>
						<span className="mt-0.5 block text-xs text-neutral-500">
							Operations raises an alert when a value reaches its threshold.
						</span>
					</span>
					<span className="flex shrink-0 items-center gap-2 text-xs text-neutral-500">
						{dirty && <span className="font-medium text-amber-700">Unsaved changes</span>}
						<ChevronDown
							className={cn("size-4 transition-transform", open && "rotate-180")}
							aria-hidden="true"
						/>
					</span>
				</CollapsibleTrigger>

				<CollapsibleContent>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (!hasErrors) save.mutate();
						}}
					>
						<div className="overflow-x-auto border-t border-neutral-100">
							<table className="w-full min-w-[36rem] text-sm">
								<thead>
									<tr className="border-b border-neutral-100 text-left text-xs text-neutral-500">
										<th scope="col" className="px-5 py-2 font-normal">
											Metric
										</th>
										<th scope="col" className="px-5 py-2 text-right font-normal">
											Now
										</th>
										<th scope="col" className="w-56 px-5 py-2 font-normal">
											Alert at
										</th>
									</tr>
								</thead>
								{GROUPS.map((group) => (
									<tbody key={group} className="divide-y divide-neutral-100">
										<tr>
											<th
												colSpan={3}
												scope="colgroup"
												className="bg-neutral-50/80 px-5 py-1.5 text-left text-[11px] font-medium tracking-wide text-neutral-500 uppercase"
											>
												{group}
											</th>
										</tr>
										{THRESHOLD_FIELDS.filter((field) => field.group === group).map((field) => {
											const current = field.current(health);
											const over = isOverThreshold(field, current, saved[field.field]);
											const error = errors[field.field];
											return (
												<tr key={field.field}>
													<th scope="row" className="px-5 py-2 text-left font-normal">
														<label
															htmlFor={`threshold-${field.field}`}
															className="text-neutral-900"
														>
															{field.label}
														</label>
														{field.hint && (
															<span className="block text-xs text-neutral-500">{field.hint}</span>
														)}
													</th>
													<td
														className={cn(
															"px-5 py-2 text-right whitespace-nowrap tabular-nums",
															over ? "font-medium text-red-700" : "text-neutral-600",
														)}
													>
														{formatCurrent(field, current)}
													</td>
													<td className="px-5 py-2">
														<div className="flex items-center gap-2">
															<Input
																id={`threshold-${field.field}`}
																type="number"
																inputMode="numeric"
																min={field.min}
																max={field.max}
																step={1}
																value={Number.isNaN(draft[field.field]) ? "" : draft[field.field]}
																aria-invalid={!!error}
																aria-describedby={
																	error ? `threshold-${field.field}-error` : undefined
																}
																onChange={(event) =>
																	setDraft((previous) => ({
																		...previous,
																		[field.field]:
																			event.target.value === ""
																				? Number.NaN
																				: Number(event.target.value),
																	}))
																}
																className="h-8 w-28 tabular-nums"
															/>
															<span className="text-xs text-neutral-500">{field.unit}</span>
														</div>
														{error && (
															<p
																id={`threshold-${field.field}-error`}
																className="mt-1 text-xs text-red-600"
															>
																{error}
															</p>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								))}
							</table>
						</div>

						{needsIdentity && (
							<div className="border-t border-neutral-100 bg-neutral-50/70 px-5 py-4">
								<p className="flex items-center gap-2 text-sm font-medium text-neutral-900">
									<ShieldCheck className="size-4 text-primary" aria-hidden="true" />
									Confirm it’s you to change alert thresholds
								</p>
								<p className="mt-0.5 text-xs text-neutral-500">
									Confirmation lasts 15 minutes for other sensitive changes too.
								</p>
								<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
									<div className="space-y-1.5">
										<Label htmlFor="thresholds-password">Current password</Label>
										<Input
											id="thresholds-password"
											type="password"
											autoComplete="current-password"
											required
											value={password}
											onChange={(event) => setPassword(event.target.value)}
										/>
									</div>
									{mfaEnabled && (
										<div className="space-y-1.5">
											<Label htmlFor="thresholds-code">Authenticator or recovery code</Label>
											<Input
												id="thresholds-code"
												autoComplete="one-time-code"
												inputMode="numeric"
												required
												value={code}
												onChange={(event) => setCode(event.target.value)}
											/>
										</div>
									)}
								</div>
							</div>
						)}

						<div className="flex flex-wrap items-center justify-end gap-2 border-t border-neutral-100 px-5 py-3">
							{saveError && (
								<p role="alert" className="mr-auto text-sm text-red-700">
									{saveError}
								</p>
							)}
							{!saveError && !dirty && (
								<p className="mr-auto text-xs text-neutral-500">No unsaved changes.</p>
							)}
							<Button
								type="button"
								variant="ghost"
								disabled={!dirty || save.isPending}
								onClick={() => {
									setDraft(saved);
									setNeedsIdentity(false);
									save.reset();
								}}
							>
								Discard
							</Button>
							<Button type="submit" disabled={!dirty || hasErrors || save.isPending}>
								{submitLabel}
							</Button>
						</div>
					</form>
				</CollapsibleContent>
			</section>
		</Collapsible>
	);
}
