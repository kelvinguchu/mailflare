"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, HardDrive, OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { OperationalHealth, QueueHealth } from "@/lib/operations/types";
import { cn } from "@/lib/utils";
import type { Tone } from "./types";
import {
	alertCounts,
	formatBytes,
	formatCount,
	formatDateTime,
	formatDuration,
	formatGrowth,
	formatRelative,
	getAlertLink,
	getDeliveryRate,
	getDeliverySegments,
	getOldestQueueMinutes,
	getTotalBacklog,
	minutesSince,
	queueTone,
	toneForThreshold,
} from "./utils";

const TONE_TEXT: Record<Tone, string> = {
	neutral: "text-neutral-900",
	good: "text-emerald-700",
	warning: "text-amber-700",
	critical: "text-red-700",
};

const TONE_DOT: Record<Tone, string> = {
	neutral: "bg-neutral-300",
	good: "bg-emerald-500",
	warning: "bg-amber-500",
	critical: "bg-red-500",
};

const QUEUE_LABELS: Record<QueueHealth["name"], string> = {
	inbound: "Inbound mail",
	outbound: "Outbound mail",
	webhook: "Webhooks",
};

function sentence(text: string): string {
	return text.charAt(0).toUpperCase() + text.slice(1);
}

function worstTone(tones: Tone[]): Tone {
	if (tones.includes("critical")) return "critical";
	if (tones.includes("warning")) return "warning";
	return "neutral";
}

export function StatusBanner({
	health,
	measuring,
	onMeasure,
}: Readonly<{ health: OperationalHealth; measuring: boolean; onMeasure: () => void }>) {
	if (health.status === "healthy") {
		return (
			<section
				aria-label="Overall status"
				className="flex items-center gap-3 rounded-2xl bg-emerald-50 px-5 py-3.5 text-sm text-emerald-900"
			>
				<CheckCircle2 className="size-5 shrink-0 text-emerald-600" aria-hidden="true" />
				<p>
					<span className="font-medium">All systems healthy.</span> No alert thresholds are
					exceeded.
				</p>
			</section>
		);
	}

	const counts = alertCounts(health.alerts);
	const critical = health.status === "critical";
	const summary = [
		counts.critical ? `${counts.critical} critical` : null,
		counts.warning ? `${counts.warning} ${counts.warning === 1 ? "warning" : "warnings"}` : null,
	]
		.filter(Boolean)
		.join(", ");
	const alerts = [...health.alerts].sort(
		(a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"),
	);
	const Icon = critical ? OctagonAlert : AlertTriangle;

	return (
		<section
			aria-labelledby="operations-status"
			className={cn(
				"overflow-hidden rounded-2xl ring-1",
				critical ? "bg-red-50/70 ring-red-200" : "bg-amber-50/70 ring-amber-200",
			)}
		>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3.5">
				<Icon
					className={cn("size-5 shrink-0", critical ? "text-red-600" : "text-amber-600")}
					aria-hidden="true"
				/>
				<h2
					id="operations-status"
					className={cn("text-sm font-semibold", critical ? "text-red-900" : "text-amber-900")}
				>
					{critical ? "Critical issues need attention" : "Some checks need attention"}
				</h2>
				<span className="text-sm text-neutral-600">{summary}</span>
			</div>
			<ul className="divide-y divide-black/5 border-t border-black/5 bg-white/60">
				{alerts.map((alert) => {
					const link = getAlertLink(alert.code);
					return (
						<li
							key={alert.code}
							className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm"
						>
							<span
								className={cn(
									"size-2 shrink-0 rounded-full",
									alert.severity === "critical" ? "bg-red-500" : "bg-amber-500",
								)}
							/>
							<span className="sr-only">{alert.severity}:</span>
							<span className="min-w-0 flex-1 text-neutral-800">{sentence(alert.message)}</span>
							{link?.kind === "measure" && (
								<Button
									type="button"
									variant="link"
									size="xs"
									disabled={measuring}
									onClick={onMeasure}
								>
									{measuring ? "Measuring…" : link.label}
								</Button>
							)}
							{link && link.kind !== "measure" && (
								<Link
									href={link.href}
									className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
								>
									{link.label}
									<ArrowRight className="size-3" aria-hidden="true" />
								</Link>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}

type Kpi = {
	label: string;
	value: string;
	detail: string;
	tone: Tone;
	href?: string;
	title?: string;
};

export function KpiStrip({ health, now }: Readonly<{ health: OperationalHealth; now: Date }>) {
	const { delivery, thresholds } = health;
	const rate = getDeliveryRate(health);
	const finished =
		delivery.delivered24h + delivery.failed24h + delivery.suppressed24h + delivery.unknown24h;
	const oldest = getOldestQueueMinutes(health, now);
	const kpis: Kpi[] = [
		{
			label: "Delivery rate · 24 h",
			value: rate === null ? "—" : `${rate.toFixed(rate === 100 ? 0 : 1)}%`,
			detail: finished
				? `${formatCount(delivery.delivered24h)} of ${formatCount(finished)} delivered`
				: "No finished deliveries",
			tone: "neutral",
		},
		{
			label: "Failed · 24 h",
			value: formatCount(delivery.failed24h),
			detail: `Alert at ${formatCount(thresholds.deliveryFailed24hWarning)}`,
			tone: toneForThreshold(delivery.failed24h, thresholds.deliveryFailed24hWarning, "critical"),
			href: "/delivery-failures",
		},
		{
			label: "Unknown outcome · 24 h",
			value: formatCount(delivery.unknown24h),
			detail: `Alert at ${formatCount(thresholds.deliveryUnknown24hWarning)}`,
			tone: toneForThreshold(delivery.unknown24h, thresholds.deliveryUnknown24hWarning, "critical"),
		},
		{
			label: "Queued now",
			value: formatCount(getTotalBacklog(health)),
			detail: oldest === null ? "Nothing waiting" : `Oldest ${formatDuration(oldest)}`,
			tone: worstTone(health.queues.map((queue) => queueTone(queue, thresholds, now))),
		},
		{
			label: "Dead letters",
			value: formatCount(health.deadLetters.unresolved),
			detail: health.deadLetters.replaying
				? `${formatCount(health.deadLetters.replaying)} replaying`
				: `Alert at ${formatCount(thresholds.deadLetterUnresolvedWarning)}`,
			tone: toneForThreshold(
				health.deadLetters.unresolved,
				thresholds.deadLetterUnresolvedWarning,
				"critical",
			),
			href: "/delivery-failures",
		},
		{
			label: "Last backup",
			value: health.backup.lastSuccessfulAt
				? formatRelative(health.backup.lastSuccessfulAt, now)
				: "Never",
			detail: `Stale after ${health.backup.staleAfterHours} h`,
			tone: health.backup.isStale ? "critical" : "neutral",
			href: "/backups",
			title: formatDateTime(health.backup.lastSuccessfulAt),
		},
	];

	return (
		<dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-neutral-200/70 md:grid-cols-3 2xl:grid-cols-6">
			{kpis.map((kpi) => (
				<div
					key={kpi.label}
					className={cn(
						"relative min-w-0 bg-white px-5 py-4",
						kpi.href &&
							"transition-colors focus-within:bg-neutral-50 hover:bg-neutral-50 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-primary/30 has-[a:focus-visible]:ring-inset",
					)}
				>
					<dt className="flex items-center gap-1.5 text-xs text-neutral-500">
						{kpi.tone !== "neutral" && (
							<span
								className={cn("size-1.5 rounded-full", TONE_DOT[kpi.tone])}
								aria-hidden="true"
							/>
						)}
						{kpi.label}
					</dt>
					<dd
						className={cn(
							"mt-1 truncate text-2xl font-semibold tracking-tight tabular-nums",
							TONE_TEXT[kpi.tone],
						)}
						title={kpi.title}
					>
						{kpi.href ? (
							// The link stretches over the whole cell while keeping the list semantics valid.
							<Link href={kpi.href} className="outline-none after:absolute after:inset-0">
								{kpi.value}
							</Link>
						) : (
							kpi.value
						)}
					</dd>
					<dd className="mt-0.5 truncate text-xs text-neutral-500">{kpi.detail}</dd>
				</div>
			))}
		</dl>
	);
}

function SectionHeading({
	id,
	title,
	description,
	action,
}: Readonly<{ id: string; title: string; description?: string; action?: ReactNode }>) {
	return (
		<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 px-5 pt-5 pb-3">
			<div className="min-w-0">
				<h2 id={id} className="text-[15px] font-medium text-neutral-900">
					{title}
				</h2>
				{description && <p className="mt-0.5 text-xs text-neutral-500">{description}</p>}
			</div>
			{action}
		</div>
	);
}

function StatusText({ tone, children }: Readonly<{ tone: Tone; children: ReactNode }>) {
	return (
		<span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", TONE_TEXT[tone])}>
			<span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} aria-hidden="true" />
			{children}
		</span>
	);
}

const TABLE_HEAD = "px-5 py-2 text-xs font-normal whitespace-nowrap text-neutral-500";

export function ProcessingPanel({
	health,
	now,
}: Readonly<{ health: OperationalHealth; now: Date }>) {
	const { thresholds } = health;
	const segments = getDeliverySegments(health);
	const total = segments.reduce((sum, segment) => sum + segment.count, 0);
	const summary = segments
		.filter((segment) => segment.count > 0)
		.map((segment) => `${segment.count} ${segment.label.toLowerCase()}`)
		.join(", ");

	const backgroundRows = [
		{
			label: "Outbound jobs",
			waiting: health.delivery.pendingJobs,
			retrying: health.delivery.retryingJobs,
			failed: null,
			tone: "neutral" as Tone,
		},
		{
			label: "Webhook deliveries",
			waiting: health.webhooks.pending,
			retrying: health.webhooks.retrying,
			failed: health.webhooks.failed24h,
			tone: toneForThreshold(
				health.webhooks.failed24h,
				thresholds.webhookFailed24hWarning,
				"warning",
			),
		},
		{
			label: "Calendar reminders",
			waiting: health.reminders.scheduled + health.reminders.processing,
			retrying: health.reminders.retrying,
			failed: health.reminders.failed24h,
			tone: toneForThreshold(
				health.reminders.failed24h,
				thresholds.reminderFailed24hWarning,
				"warning",
			),
		},
		{
			label: "Dead letters",
			waiting: health.deadLetters.unresolved,
			retrying: health.deadLetters.replaying,
			failed: null,
			tone: toneForThreshold(
				health.deadLetters.unresolved,
				thresholds.deadLetterUnresolvedWarning,
				"critical",
			),
		},
	];

	return (
		<section className="min-w-0 rounded-2xl bg-white" aria-label="Queues and processing">
			<div id="queues" className="scroll-mt-6">
				<SectionHeading
					id="queues-heading"
					title="Queues"
					description="Live Cloudflare Queue metrics at the time of the last check."
				/>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[34rem] text-sm" aria-labelledby="queues-heading">
						<thead>
							<tr className="border-y border-neutral-100 text-left">
								<th scope="col" className={TABLE_HEAD}>
									Queue
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Waiting
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Size
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Oldest message
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Status
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-neutral-100">
							{health.queues.map((queue) => {
								const tone = queueTone(queue, thresholds, now);
								const age = minutesSince(queue.oldestMessageAt, now);
								let status = "Normal";
								if (!queue.available) status = "Metrics unavailable";
								else if (tone === "critical") status = "Delayed";
								else if (tone === "warning") status = "Backlogged";
								return (
									<tr key={queue.name}>
										<th scope="row" className="px-5 py-2.5 text-left font-medium text-neutral-900">
											{QUEUE_LABELS[queue.name] ?? queue.name}
										</th>
										<td className="px-5 py-2.5 text-right tabular-nums text-neutral-900">
											{queue.available ? formatCount(queue.backlogCount) : "—"}
										</td>
										<td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
											{queue.available ? formatBytes(queue.backlogBytes) : "—"}
										</td>
										<td
											className="px-5 py-2.5 text-right tabular-nums text-neutral-600"
											title={
												queue.oldestMessageAt ? formatDateTime(queue.oldestMessageAt) : undefined
											}
										>
											{age === null ? "—" : formatDuration(age)}
										</td>
										<td className="px-5 py-2.5 text-right">
											<StatusText tone={tone === "good" ? "good" : tone}>{status}</StatusText>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			</div>

			<div className="border-t border-neutral-100">
				<SectionHeading
					id="delivery-heading"
					title="Outbound delivery"
					description="Current state of mail sent in the last 24 hours."
					action={
						<span className="text-xs text-neutral-500 tabular-nums">
							{formatCount(total)} {total === 1 ? "message" : "messages"}
						</span>
					}
				/>
				<div className="px-5 pb-5">
					{total === 0 ? (
						<p className="rounded-lg bg-neutral-50 px-4 py-3 text-sm text-neutral-500">
							No outbound mail in the last 24 hours.
						</p>
					) : (
						<>
							<div
								role="img"
								aria-label={`Outbound delivery in the last 24 hours: ${summary}.`}
								className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100"
							>
								{segments
									.filter((segment) => segment.count > 0)
									.map((segment) => (
										<span
											key={segment.key}
											className={cn(
												"h-full min-w-1 first:rounded-l-full last:rounded-r-full",
												segment.className,
											)}
											style={{ width: `${segment.percent}%` }}
										/>
									))}
							</div>
							<ul className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
								{segments.map((segment) => (
									<li key={segment.key} className="flex min-w-0 items-center gap-2">
										<span
											className={cn("size-2 shrink-0 rounded-full", segment.className)}
											aria-hidden="true"
										/>
										<span className="min-w-0 truncate text-neutral-600">{segment.label}</span>
										<span className="ml-auto font-medium tabular-nums text-neutral-900 sm:ml-0">
											{formatCount(segment.count)}
										</span>
										<span className="text-xs tabular-nums text-neutral-400">
											{segment.percent.toFixed(
												segment.percent >= 10 || segment.percent === 0 ? 0 : 1,
											)}
											%
										</span>
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			</div>

			<div className="border-t border-neutral-100 pb-2">
				<SectionHeading
					id="background-heading"
					title="Background work"
					description="Jobs waiting or retrying now, and failures in the last 24 hours."
				/>
				<div className="overflow-x-auto">
					<table className="w-full min-w-[30rem] text-sm" aria-labelledby="background-heading">
						<thead>
							<tr className="border-y border-neutral-100 text-left">
								<th scope="col" className={TABLE_HEAD}>
									Work
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Waiting
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Retrying
								</th>
								<th scope="col" className={cn(TABLE_HEAD, "text-right")}>
									Failed · 24 h
								</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-neutral-100">
							{backgroundRows.map((row) => (
								<tr key={row.label}>
									<th scope="row" className="px-5 py-2.5 text-left font-medium text-neutral-900">
										<span className="inline-flex items-center gap-2">
											{row.label}
											{row.tone !== "neutral" && (
												<StatusText tone={row.tone}>
													<span className="sr-only">Over threshold</span>
												</StatusText>
											)}
										</span>
									</th>
									<td className="px-5 py-2.5 text-right tabular-nums text-neutral-900">
										{formatCount(row.waiting)}
									</td>
									<td className="px-5 py-2.5 text-right tabular-nums text-neutral-600">
										{formatCount(row.retrying)}
									</td>
									<td
										className={cn(
											"px-5 py-2.5 text-right tabular-nums",
											row.failed === null ? "text-neutral-400" : TONE_TEXT[row.tone],
										)}
									>
										{formatCount(row.failed)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</section>
	);
}

function DetailRow({
	label,
	value,
	detail,
	tone = "neutral",
	title,
}: Readonly<{ label: string; value: string; detail?: string; tone?: Tone; title?: string }>) {
	return (
		<div className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 px-5 py-2.5 text-sm">
			<dt className="text-neutral-500">{label}</dt>
			<dd className="min-w-0 text-right">
				<span className={cn("font-medium", TONE_TEXT[tone])} title={title}>
					{value}
				</span>
				{detail && <span className="block truncate text-xs text-neutral-500">{detail}</span>}
			</dd>
		</div>
	);
}

const DRILL_SOURCES: Record<string, string> = {
	"staging-script": "staging script",
	manual: "manual check",
};

export function RecoveryStoragePanel({
	health,
	now,
	measuring,
	measureError,
	onMeasure,
}: Readonly<{
	health: OperationalHealth;
	now: Date;
	measuring: boolean;
	measureError: string | null;
	onMeasure: () => void;
}>) {
	const { backup, restoreDrill, storage, thresholds } = health;
	const failedMoreRecently =
		!!backup.lastFailedAt &&
		(!backup.lastSuccessfulAt || new Date(backup.lastFailedAt) > new Date(backup.lastSuccessfulAt));
	const d1Tone = toneForThreshold(
		storage.growth?.d1Percent ?? null,
		thresholds.d1GrowthPercentWarning,
		"warning",
	);
	const r2Tone = toneForThreshold(
		storage.growth?.r2Percent ?? null,
		thresholds.r2GrowthPercentWarning,
		"warning",
	);
	const since = storage.growth?.since
		? `since ${formatRelative(storage.growth.since, now)}`
		: undefined;

	return (
		<section className="min-w-0 rounded-2xl bg-white" aria-label="Backup, recovery, and storage">
			<SectionHeading
				id="recovery-heading"
				title="Backup and recovery"
				action={
					<Link
						href="/backups"
						className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
					>
						Manage backups
						<ArrowRight className="size-3" aria-hidden="true" />
					</Link>
				}
			/>
			<dl className="divide-y divide-neutral-100 border-t border-neutral-100">
				<DetailRow
					label="Automatic backups"
					value={backup.enabled ? sentence(backup.scheduleType) : "Off"}
					tone={backup.enabled ? "neutral" : "warning"}
				/>
				<DetailRow
					label="Last successful"
					value={formatRelative(backup.lastSuccessfulAt, now)}
					detail={
						backup.lastSuccessfulAt
							? formatDateTime(backup.lastSuccessfulAt)
							: "No backup has completed"
					}
					tone={backup.isStale ? "critical" : "neutral"}
				/>
				<DetailRow label="Considered stale after" value={`${backup.staleAfterHours} hours`} />
				<DetailRow
					label="Last failure"
					value={backup.lastFailedAt ? formatRelative(backup.lastFailedAt, now) : "None"}
					detail={backup.lastFailedAt ? formatDateTime(backup.lastFailedAt) : undefined}
					tone={failedMoreRecently ? "warning" : "neutral"}
				/>
				<DetailRow
					label="Verified restore drill"
					value={
						restoreDrill?.lastVerifiedAt
							? formatRelative(restoreDrill.lastVerifiedAt, now)
							: "Never verified"
					}
					detail={
						restoreDrill?.lastVerifiedAt
							? [
									restoreDrill.environment,
									restoreDrill.source && DRILL_SOURCES[restoreDrill.source],
								]
									.filter(Boolean)
									.join(" · ")
							: "Run a restore drill to prove backups can be restored."
					}
					tone={restoreDrill?.lastVerifiedAt ? "neutral" : "warning"}
				/>
			</dl>

			<div id="storage" className="scroll-mt-6 border-t border-neutral-100 pb-2">
				<SectionHeading
					id="storage-heading"
					title="Storage"
					description={
						storage.latest
							? `Measured ${formatRelative(storage.latest.capturedAt, now)}`
							: "Not measured yet"
					}
					action={
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={measuring}
							onClick={onMeasure}
						>
							<HardDrive />
							{measuring ? "Measuring…" : "Measure now"}
						</Button>
					}
				/>
				{measureError && (
					<p role="alert" className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
						{measureError}
					</p>
				)}
				{storage.latest ? (
					<dl className="divide-y divide-neutral-100 border-t border-neutral-100">
						<DetailRow
							label="D1 database"
							value={formatBytes(storage.latest.d1Bytes)}
							detail={[formatGrowth(storage.growth?.d1Percent ?? null), since]
								.filter(Boolean)
								.join(" ")}
							tone={d1Tone}
						/>
						<DetailRow
							label="R2 objects"
							value={formatBytes(storage.latest.r2Bytes)}
							detail={`${formatCount(storage.latest.r2ObjectCount)} objects · ${formatGrowth(storage.growth?.r2Percent ?? null)}`}
							tone={r2Tone}
						/>
						{!storage.latest.r2ScanComplete && (
							<p className="px-5 py-2.5 text-xs text-amber-700">
								The R2 scan stopped at its safety limit, so these values are a lower bound.
							</p>
						)}
					</dl>
				) : (
					<p className="border-t border-neutral-100 px-5 py-3 text-sm text-neutral-500">
						Measure storage to record D1 and R2 usage. Growth alerts start from the second
						measurement.
					</p>
				)}
			</div>
		</section>
	);
}
