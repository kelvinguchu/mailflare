"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
	ArrowLeft,
	ChevronLeft,
	ChevronRight,
	ListFilter,
	MoreVertical,
	RefreshCw,
} from "lucide-react";
import { authFetch, AUTH_SESSION_CHANGED_EVENT } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { SkeletonRows } from "@/components/ui/skeleton";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogBody,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useMailSearch } from "@/components/mail-search/mail-search-context";
import { MessageListRow } from "@/components/messages/message-folder-page";
import { inboxFolderConfig } from "@/components/messages/message-folder-configs";
import type { Message } from "@/hooks/types";
import type { InspectionMessage, InspectionRow, TeamMailbox } from "./types";
import { InspectionReader } from "./inspection-reader";
import { InspectionStateBadge } from "./inspection-state-badge";
async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
	const response = await authFetch(url, { cache: "no-store", signal });
	if (!response.ok)
		throw new Error(response.status === 403 ? "Inspection access denied" : "Could not load mail");
	return response.json() as Promise<T>;
}
const systemFolders = [
	["all", "All mail"],
	["inbox", "Inbox"],
	["sent", "Sent"],
	["drafts", "Drafts"],
	["archived", "Archived"],
	["spam", "Spam"],
	["trash", "Trash"],
	["deleted", "Deleted"],
];
function listMessage(row: InspectionRow): Message {
	return {
		id: row.id,
		userId: "",
		mailboxId: row.mailboxId,
		folderId: null,
		direction: row.direction as Message["direction"],
		providerMessageId: null,
		fromAddr: row.fromAddr,
		toAddr: row.toAddr,
		subject: row.subject,
		snippet: row.snippet,
		status: row.status,
		read: row.read,
		starred: false,
		threadId: null,
		createdAt: row.createdAt,
	};
}
const badgeClass =
	"ml-2 inline-flex rounded bg-neutral-100 px-1.5 py-0.5 align-middle text-[11px] font-medium text-neutral-600";
export function TeamInboxView({ identity, mfaEnabled }: { identity: string; mfaEnabled: boolean }) {
	const router = useRouter(),
		epoch = useRef(0),
		searchAudit = useRef("");
	const { debouncedQuery } = useMailSearch();
	const [boxes, setBoxes] = useState<TeamMailbox[]>([]),
		[mailboxId, setMailboxId] = useState(""),
		[folder, setFolder] = useState("all"),
		[folders, setFolders] = useState<{ id: string; name: string }[]>([]);
	const [filters, setFilters] = useState(""),
		[page, setPage] = useState(0),
		[refresh, setRefresh] = useState(0),
		[result, setResult] = useState<{ messages: InspectionRow[]; total: number }>({
			messages: [],
			total: 0,
		}),
		[busy, setBusy] = useState(false),
		[error, setError] = useState("");
	const [conversation, setConversation] = useState<InspectionMessage[] | null>(null),
		[activeId, setActiveId] = useState(""),
		[filterOpen, setFilterOpen] = useState(false),
		[auditOpen, setAuditOpen] = useState(false),
		[events, setEvents] = useState<{ id: string; action: string; createdAt: number }[]>([]);
	useEffect(() => {
		const controller = new AbortController();
		const invalidate = () => {
			epoch.current++;
		};
		const clear = () => {
			invalidate();
			controller.abort();
			setBoxes([]);
			setResult({ messages: [], total: 0 });
			setConversation(null);
			setEvents([]);
			router.replace("/inbox");
		};
		window.addEventListener(AUTH_SESSION_CHANGED_EVENT, clear);
		void read<{ mailboxes: TeamMailbox[] }>("/api/team-inboxes", controller.signal)
			.then((data) => {
				if (!controller.signal.aborted) setBoxes(data.mailboxes);
			})
			.catch((reason) => {
				if (!controller.signal.aborted) setError(String(reason));
			});
		void authFetch("/api/team-inboxes/session", {
			method: "POST",
			signal: controller.signal,
		}).catch(() => {});
		return () => {
			invalidate();
			controller.abort();
			window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, clear);
		};
	}, [identity, router]);
	useEffect(() => {
		setPage(0);
	}, [debouncedQuery, filters, mailboxId, folder]);
	useEffect(() => {
		const controller = new AbortController(),
			params = new URLSearchParams(filters);
		params.set("q", debouncedQuery);
		params.set("limit", "25");
		params.set("offset", String(page * 25));
		params.set("folder", folder);
		if (mailboxId) params.set("mailboxId", mailboxId);
		const fingerprint = `${debouncedQuery}:${filters}:${mailboxId}`;
		if ((debouncedQuery || filters) && fingerprint !== searchAudit.current) {
			params.set("audit", "1");
			searchAudit.current = fingerprint;
		}
		setBusy(true);
		setError("");
		void read<{ messages: InspectionRow[]; total: number }>(
			`/api/team-inboxes/search?${params}`,
			controller.signal,
		)
			.then((data) => {
				if (!controller.signal.aborted) setResult(data);
			})
			.catch((reason) => {
				if (!controller.signal.aborted) {
					setResult({ messages: [], total: 0 });
					setConversation(null);
					setError(String(reason));
				}
			})
			.finally(() => {
				if (!controller.signal.aborted) setBusy(false);
			});
		return () => controller.abort();
	}, [debouncedQuery, filters, folder, mailboxId, page, refresh]);
	useEffect(() => {
		const timer = window.setInterval(() => {
			if (document.visibilityState === "visible") setRefresh((value) => value + 1);
		}, 60000);
		return () => window.clearInterval(timer);
	}, []);
	useEffect(() => {
		const controller = new AbortController();
		setFolders([]);
		if (mailboxId)
			void read<{ folders: { id: string; name: string }[] }>(
				`/api/team-inboxes/folders/${encodeURIComponent(mailboxId)}`,
				controller.signal,
			)
				.then((data) => {
					if (!controller.signal.aborted) setFolders(data.folders);
				})
				.catch(() => {});
		return () => controller.abort();
	}, [mailboxId]);
	const open = useCallback(async (id: string, audit = true) => {
		const version = ++epoch.current;
		setActiveId(id);
		setConversation(null);
		setBusy(true);
		try {
			const data = await read<{ messages: InspectionMessage[] }>(
				`/api/team-inboxes/messages/${id}/thread${audit ? "?audit=1" : ""}`,
			);
			if (epoch.current === version) setConversation(data.messages);
		} catch (reason) {
			if (epoch.current === version) setError(String(reason));
		} finally {
			if (epoch.current === version) setBusy(false);
		}
	}, []);
	function back() {
		epoch.current++;
		setActiveId("");
		setConversation(null);
	}
	const focus = conversation?.find((item) => item.message.id === activeId) ?? conversation?.[0];
	return (
		<div className="flex h-full min-h-0 flex-col">
			<h1 className="sr-only">Team’s inbox</h1>
			<div
				className={`flex min-h-12 shrink-0 items-center justify-between gap-2 border-b border-neutral-200 px-4 ${!activeId ? "max-sm:flex-wrap max-sm:gap-0 max-sm:py-1" : ""}`}
			>
				<div
					className={`flex min-w-0 flex-wrap items-center gap-2 ${!activeId ? "max-sm:w-full" : ""}`}
				>
					{activeId ? (
						<>
							<Tooltip label="Back">
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Back to message list"
									onClick={back}
								>
									<ArrowLeft className="size-4" />
								</Button>
							</Tooltip>
							<span className="truncate text-xs text-neutral-500">
								{focus?.message.originalMailboxAddress}
							</span>
						</>
					) : (
						<>
							<Select
								value={mailboxId || "all"}
								onValueChange={(value) => setMailboxId(value && value !== "all" ? value : "")}
							>
								<SelectTrigger
									aria-label="Team mailbox"
									size="sm"
									className="grid h-auto min-h-8 w-max max-w-full grid-cols-[minmax(0,1fr)_auto] border-none bg-transparent py-1.5 shadow-none *:data-[slot=select-value]:line-clamp-none"
								>
									<span
										aria-hidden="true"
										className="invisible pointer-events-none col-start-1 row-start-1 grid"
									>
										{["All team mailboxes", ...boxes.map((box) => box.address)].map((address) => (
											<span key={address} className="col-start-1 row-start-1">
												{address}
											</span>
										))}
									</span>
									<SelectValue className="col-start-1 row-start-1 min-w-0 whitespace-normal break-all">
										{() =>
											boxes.find((box) => box.id === mailboxId)?.address ?? "All team mailboxes"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent
									align="start"
									alignItemWithTrigger={false}
									className="w-max min-w-(--anchor-width) max-w-[calc(100vw-2rem)]"
								>
									<SelectItem value="all">All team mailboxes</SelectItem>
									{boxes.map((box) => (
										<SelectItem
											key={box.id}
											value={box.id}
											className="[&>span:first-child]:min-w-0 [&>span:first-child]:shrink [&>span:first-child]:whitespace-normal [&>span:first-child]:break-all"
										>
											{box.address}
											{box.disabled || box.archivedAt ? " (inactive)" : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<Select value={folder} onValueChange={(value) => setFolder(value ?? "all")}>
								<SelectTrigger
									aria-label="Mail folder"
									size="sm"
									className="max-w-28 border-none bg-transparent shadow-none"
								>
									<SelectValue>
										{() =>
											[...systemFolders, ...folders.map((item) => [item.id, item.name])].find(
												([id]) => id === folder,
											)?.[1] ?? "All mail"
										}
									</SelectValue>
								</SelectTrigger>
								<SelectContent>
									{[...systemFolders, ...folders.map((item) => [item.id, item.name])].map(
										([id, label]) => (
											<SelectItem key={id} value={id}>
												{label}
											</SelectItem>
										),
									)}
								</SelectContent>
							</Select>
						</>
					)}
				</div>
				<div
					className={`flex shrink-0 items-center gap-1 text-neutral-500 ${!activeId ? "max-sm:w-full max-sm:justify-end" : ""}`}
				>
					{!activeId && (
						<>
							<span className="hidden whitespace-nowrap text-xs sm:inline">
								{result.total ? page * 25 + 1 : 0} -{" "}
								{Math.min(page * 25 + result.messages.length, result.total)} of {result.total}
							</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Previous page"
								disabled={!page || busy}
								onClick={() => setPage(page - 1)}
							>
								<ChevronLeft className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Next page"
								disabled={(page + 1) * 25 >= result.total || busy}
								onClick={() => setPage(page + 1)}
							>
								<ChevronRight className="size-4" />
							</Button>
						</>
					)}
					<Tooltip label="Refresh">
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label="Refresh"
							disabled={busy}
							onClick={() => {
								setRefresh((value) => value + 1);
								if (activeId) void open(activeId, false);
							}}
						>
							<RefreshCw className="size-4" />
						</Button>
					</Tooltip>
					{!activeId && (
						<Tooltip label="Filters">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Filters"
								onClick={() => setFilterOpen(true)}
								className={filters ? "text-primary bg-primary/10" : undefined}
							>
								<ListFilter className="size-4" />
							</Button>
						</Tooltip>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger
							aria-label="More"
							render={<Button variant="ghost" size="icon-sm" />}
						>
							<MoreVertical className="size-4" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem
								onClick={() => {
									setAuditOpen(true);
									void read<{ events: typeof events }>("/api/team-inboxes/audit")
										.then((data) => setEvents(data.events))
										.catch((reason) => setError(String(reason)));
								}}
							>
								Inspection activity
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{error && (
				<p role="alert" className="px-4 py-3 text-sm text-red-700">
					{error}
				</p>
			)}
			<div
				className="min-h-0 flex-1 divide-y divide-neutral-100 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable"
				aria-busy={busy}
			>
				{activeId ? (
					conversation ? (
						<>
							<div className="px-4 pt-5 sm:pl-[76px]">
								<h2 className="text-[22px] leading-snug break-words text-neutral-900 max-sm:text-lg">
									{focus?.message.subject ?? "(no subject)"}
								</h2>
							</div>
							{conversation.map((data) => (
								<InspectionReader
									key={data.message.id}
									data={data}
									mfaEnabled={mfaEnabled}
									onRemoved={() => {
										back();
										setRefresh((value) => value + 1);
									}}
								/>
							))}
						</>
					) : (
						<SkeletonRows count={4} />
					)
				) : (
					<>
						{busy && !result.messages.length && <SkeletonRows count={8} />}{" "}
						{result.messages.map((row) => (
							<ResponsiveInspectionRow
								key={row.id}
								row={row}
								onOpen={() => void open(row.id)}
								mailboxSelected={!!mailboxId}
							/>
						))}
						{!busy && !result.messages.length && (
							<p className="px-4 py-3 text-sm text-neutral-500">No emails</p>
						)}
					</>
				)}
			</div>
			<Dialog open={filterOpen} onOpenChange={setFilterOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Filter mail</DialogTitle>
					</DialogHeader>
					<DialogBody>
						<form
							key={filters}
							className="grid gap-4 sm:grid-cols-2"
							onSubmit={(event) => {
								event.preventDefault();
								const params = new URLSearchParams();
								for (const [key, value] of new FormData(event.currentTarget))
									if (String(value).trim()) params.set(key, String(value));
								setFilters(params.toString());
								setFilterOpen(false);
							}}
						>
							{[
								["title", "Subject"],
								["from", "From"],
								["to", "To"],
								["after", "From date"],
								["before", "Through date"],
							].map(([name, label]) => (
								<label key={name} htmlFor={`team-filter-${name}`} className="text-sm">
									{label}
									<Input
										id={`team-filter-${name}`}
										name={name}
										type={name === "after" || name === "before" ? "date" : "text"}
										defaultValue={new URLSearchParams(filters).get(name) ?? ""}
									/>
								</label>
							))}
							<label htmlFor="team-filter-deletion" className="text-sm">
								Deletion state
								<select
									id="team-filter-deletion"
									name="deletion"
									defaultValue={new URLSearchParams(filters).get("deletion") ?? ""}
									className="mt-1 block w-full rounded-md border p-2 text-sm"
								>
									<option value="">Any</option>
									<option value="removed">Deleted</option>
									<option value="trash">In Trash</option>
									<option value="history">Any deletion history</option>
								</select>
							</label>
							<label className="text-sm">
								<input
									aria-label="Has attachments"
									type="checkbox"
									name="hasAttachments"
									value="true"
									defaultChecked={new URLSearchParams(filters).get("hasAttachments") === "true"}
								/>{" "}
								Has attachments
							</label>
							<div className="flex justify-end gap-2 sm:col-span-2">
								<Button
									variant="outline"
									type="button"
									onClick={() => {
										setFilters("");
										setFilterOpen(false);
									}}
								>
									Clear
								</Button>
								<Button type="submit">Search</Button>
							</div>
						</form>
					</DialogBody>
				</DialogContent>
			</Dialog>
			<Dialog open={auditOpen} onOpenChange={setAuditOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Inspection activity</DialogTitle>
					</DialogHeader>
					<DialogBody>
						{events.map((event) => (
							<p key={event.id} className="border-b py-2 text-sm">
								{new Date(event.createdAt * 1000).toLocaleString()} · {event.action}
							</p>
						))}
					</DialogBody>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function ResponsiveInspectionRow({
	row,
	onOpen,
	mailboxSelected,
}: {
	row: InspectionRow;
	onOpen: () => void;
	mailboxSelected: boolean;
}) {
	const props = {
		message: listMessage(row),
		config: {
			...inboxFolderConfig,
			folder: row.direction === "outbound" ? ("sent" as const) : ("inbox" as const),
			hrefPrefix: "/team-inboxes",
		},
		selected: false,
		onSelectedChange: () => {},
		onMessageAction: async () => {},
		dragMessageIds: [],
		inspection: {
			onOpen,
			badges: (
				<>
					{(row.employeeHiddenAt || row.status === "trash") && (
						<InspectionStateBadge
							state={row.employeeHiddenAt ? "deleted" : "trash"}
							className="ml-2"
						/>
					)}
					{row.status === "draft" && <InspectionStateBadge state="draft" className="ml-2" />}
					{!!row.hasDeletionHistory && !row.employeeHiddenAt && row.status !== "trash" && (
						<InspectionStateBadge state="history" className="ml-2" />
					)}
					{!mailboxSelected && (
						<span className={badgeClass}>{row.mailboxAddress ?? row.employeeEmail}</span>
					)}
				</>
			),
		},
	};
	return (
		<>
			<div className="hidden md:block">
				<MessageListRow {...props} />
			</div>
			<div className="md:hidden">
				<MessageListRow {...props} compact />
			</div>
		</>
	);
}
