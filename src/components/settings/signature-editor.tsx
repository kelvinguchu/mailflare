"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
	AlignCenter,
	AlignLeft,
	AlignRight,
	ArrowDown,
	ArrowUp,
	Bold,
	ImagePlus,
	Italic,
	Link2,
	List,
	ListOrdered,
	Plus,
	Strikethrough,
	Trash2,
	Underline,
	Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
	SIGNATURE_COLORS,
	SIGNATURE_MARKS,
	createTextRow,
	newRowId,
	normalizeSignatureLink,
	scaleImage,
	type SignatureAlign,
	type SignatureImageRow,
	type SignatureIssue,
	type SignatureListRow,
	type SignatureMark,
	type SignatureRow,
	type SignatureTextRow,
} from "./signature-model";
import type { SignatureAsset } from "./types";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const MAX_IMAGE_SIZE = 512 * 1024;
const MAX_IMAGE_COUNT = 5;
const MAX_TOTAL_IMAGE_SIZE = 2 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 600;
const IMAGE_SIZES = [
	{ label: "S", name: "Small", width: 120 },
	{ label: "M", name: "Medium", width: 200 },
	{ label: "L", name: "Large", width: 320 },
] as const;

const MARK_ICONS: Record<SignatureMark, typeof Bold> = {
	bold: Bold,
	italic: Italic,
	underline: Underline,
	strike: Strikethrough,
};
const ALIGN_ICONS: Record<SignatureAlign, typeof AlignLeft> = {
	left: AlignLeft,
	center: AlignCenter,
	right: AlignRight,
};
const MARK_CLASSES: Record<SignatureMark, string> = {
	bold: "font-semibold",
	italic: "italic",
	underline: "underline",
	strike: "line-through",
};
const ALIGN_CLASSES: Record<SignatureAlign, string> = {
	left: "text-left",
	center: "text-center",
	right: "text-right",
};

type FocusTarget = { rowId: string; item?: number };

function rowTextClasses(row: SignatureTextRow): string {
	return cn(
		ALIGN_CLASSES[row.align],
		row.marks.map((mark) => MARK_CLASSES[mark]),
		row.href && !row.marks.includes("underline") && "underline decoration-neutral-300",
	);
}

function toggleMark(marks: SignatureMark[], mark: SignatureMark): SignatureMark[] {
	return marks.includes(mark) ? marks.filter((item) => item !== mark) : [...marks, mark];
}

function ToolButton({
	label,
	active = false,
	disabled,
	onClick,
	children,
}: Readonly<{
	label: string;
	active?: boolean;
	disabled: boolean;
	onClick: () => void;
	children: ReactNode;
}>) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={label}
			title={label}
			aria-pressed={active}
			disabled={disabled}
			// Keep focus in the line being formatted.
			onMouseDown={(event) => event.preventDefault()}
			onClick={onClick}
			className={cn(active && "bg-primary/10 text-primary hover:bg-primary/15")}
		>
			{children}
		</Button>
	);
}

function Divider() {
	return <span className="mx-1 h-5 w-px shrink-0 bg-neutral-200" aria-hidden="true" />;
}

type SignatureEditorProps = {
	rows: SignatureRow[];
	assets: SignatureAsset[];
	issues: SignatureIssue[];
	disabled: boolean;
	onChange: (rows: SignatureRow[]) => void;
	/** Rendered in the insert bar; opens the image library. */
	imagePicker: ReactNode;
};

/** A document-like editor: each line is edited in place and one toolbar formats the active line. */
export function SignatureEditor({
	rows,
	assets,
	issues,
	disabled,
	onChange,
	imagePicker,
}: Readonly<SignatureEditorProps>) {
	const [activeId, setActiveId] = useState<string | null>(rows[0]?.id ?? null);
	const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
	const [linkOpen, setLinkOpen] = useState(false);
	const surfaceRef = useRef<HTMLDivElement>(null);
	const active = rows.find((row) => row.id === activeId) ?? null;
	const activeIndex = active ? rows.indexOf(active) : -1;

	useEffect(() => {
		if (!focusTarget) return;
		const selector =
			focusTarget.item === undefined
				? `[data-row-input="${focusTarget.rowId}"]`
				: `[data-row-input="${focusTarget.rowId}"][data-item="${focusTarget.item}"]`;
		const element = surfaceRef.current?.querySelector<HTMLElement>(selector);
		element?.focus();
		setFocusTarget(null);
	}, [focusTarget, rows]);

	function update(rowId: string, next: SignatureRow) {
		onChange(rows.map((row) => (row.id === rowId ? next : row)));
	}

	function insertAfter(rowId: string | null, row: SignatureRow, focusItem?: number) {
		const index = rowId ? rows.findIndex((item) => item.id === rowId) : rows.length - 1;
		const next = [...rows];
		next.splice(index + 1, 0, row);
		onChange(next);
		setActiveId(row.id);
		setFocusTarget({ rowId: row.id, item: focusItem });
	}

	function remove(rowId: string) {
		const index = rows.findIndex((row) => row.id === rowId);
		const next = rows.filter((row) => row.id !== rowId);
		onChange(next);
		const neighbour = next[Math.max(0, index - 1)];
		setActiveId(neighbour?.id ?? null);
		setLinkOpen(false);
		if (neighbour && neighbour.kind !== "image") {
			setFocusTarget({
				rowId: neighbour.id,
				item: neighbour.kind === "list" ? neighbour.items.length - 1 : undefined,
			});
		}
	}

	function move(direction: -1 | 1) {
		if (activeIndex < 0) return;
		const target = activeIndex + direction;
		if (target < 0 || target >= rows.length) return;
		const next = [...rows];
		[next[activeIndex], next[target]] = [next[target], next[activeIndex]];
		onChange(next);
		if (active && active.kind !== "image") {
			setFocusTarget({ rowId: active.id, item: active.kind === "list" ? 0 : undefined });
		}
	}

	function onLineKeyDown(event: KeyboardEvent<HTMLInputElement>, row: SignatureRow) {
		if (event.key === "Enter") {
			event.preventDefault();
			insertAfter(row.id, createTextRow("", row.kind === "text" ? { align: row.align } : {}));
		}
		if (event.key === "Backspace" && event.currentTarget.value === "" && rows.length > 1) {
			event.preventDefault();
			remove(row.id);
		}
	}

	const textRow = active?.kind === "text" ? active : null;
	const imageRow = active?.kind === "image" ? active : null;
	const alignable = textRow ?? imageRow;
	const toolsDisabled = disabled || !active;

	return (
		<div className="overflow-hidden rounded-xl border border-neutral-200 bg-white focus-within:border-neutral-300">
			<div
				role="toolbar"
				aria-label="Format the selected line"
				className="flex flex-wrap items-center gap-0.5 border-b border-neutral-100 bg-neutral-50/70 px-1.5 py-1"
			>
				{SIGNATURE_MARKS.map(({ mark, label }) => {
					const Icon = MARK_ICONS[mark];
					return (
						<ToolButton
							key={mark}
							label={label}
							active={!!textRow?.marks.includes(mark)}
							disabled={toolsDisabled || !textRow}
							onClick={() =>
								textRow &&
								update(textRow.id, { ...textRow, marks: toggleMark(textRow.marks, mark) })
							}
						>
							<Icon />
						</ToolButton>
					);
				})}
				<ToolButton
					label={textRow?.href ? "Edit link" : "Add link"}
					active={!!textRow?.href || linkOpen}
					disabled={toolsDisabled || !textRow}
					onClick={() => setLinkOpen((open) => !open)}
				>
					<Link2 />
				</ToolButton>
				<Divider />
				{(["left", "center", "right"] as const).map((align) => {
					const Icon = ALIGN_ICONS[align];
					return (
						<ToolButton
							key={align}
							label={`Align ${align}`}
							active={alignable?.align === align}
							disabled={toolsDisabled || !alignable}
							onClick={() => alignable && update(alignable.id, { ...alignable, align })}
						>
							<Icon />
						</ToolButton>
					);
				})}
				<Divider />
				<div className="flex items-center gap-1 px-1" role="group" aria-label="Text color">
					{SIGNATURE_COLORS.map((color) => {
						const selected = (textRow?.color ?? "") === color.value && !!textRow;
						return (
							<button
								key={color.value || "default"}
								type="button"
								title={color.label}
								aria-label={`${color.label} text`}
								aria-pressed={selected}
								disabled={toolsDisabled || !textRow}
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => textRow && update(textRow.id, { ...textRow, color: color.value })}
								className={cn(
									"size-4 rounded-full ring-offset-1 outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-40",
									selected ? "ring-2 ring-neutral-900" : "ring-1 ring-neutral-300",
								)}
								style={{
									background: color.value || "conic-gradient(#111827 0 50%, #ffffff 50% 100%)",
								}}
							/>
						);
					})}
				</div>
				<span className="flex-1" />
				<ToolButton
					label="Move line up"
					disabled={toolsDisabled || activeIndex <= 0}
					onClick={() => move(-1)}
				>
					<ArrowUp />
				</ToolButton>
				<ToolButton
					label="Move line down"
					disabled={toolsDisabled || activeIndex < 0 || activeIndex >= rows.length - 1}
					onClick={() => move(1)}
				>
					<ArrowDown />
				</ToolButton>
				<ToolButton
					label="Remove line"
					disabled={toolsDisabled}
					onClick={() => active && remove(active.id)}
				>
					<Trash2 />
				</ToolButton>
			</div>

			{textRow && linkOpen && (
				<LinkBar
					key={textRow.id}
					row={textRow}
					disabled={disabled}
					onChange={(href) => update(textRow.id, { ...textRow, href })}
					onClose={() => {
						setLinkOpen(false);
						setFocusTarget({ rowId: textRow.id });
					}}
				/>
			)}
			{imageRow && (
				<ImageBar
					key={imageRow.id}
					row={imageRow}
					assets={assets}
					disabled={disabled}
					onChange={(next) => update(imageRow.id, next)}
				/>
			)}

			<div ref={surfaceRef} className="space-y-0.5 px-4 py-3">
				{rows.length === 0 && (
					<button
						type="button"
						disabled={disabled}
						onClick={() => insertAfter(null, createTextRow())}
						className="w-full py-4 text-left text-sm text-neutral-400 hover:text-neutral-600"
					>
						Start typing your signature…
					</button>
				)}
				{rows.map((row, index) => {
					const rowIssues = issues.filter((issue) => issue.rowId === row.id);
					const isActive = row.id === activeId;
					return (
						<div
							key={row.id}
							className={cn(
								"group relative -mx-2 rounded-md px-2",
								isActive && "bg-primary/4 ring-1 ring-primary/15",
								rowIssues.length > 0 && "ring-1 ring-red-300",
							)}
						>
							{row.kind === "text" && (
								<div className="flex items-center gap-2">
									<input
										data-row-input={row.id}
										value={row.text}
										disabled={disabled}
										placeholder={index === 0 ? "Your name" : "Type a line"}
										aria-label={`Signature line ${index + 1}`}
										onFocus={() => setActiveId(row.id)}
										onChange={(event) => update(row.id, { ...row, text: event.target.value })}
										onKeyDown={(event) => onLineKeyDown(event, row)}
										style={{ color: row.color || undefined }}
										className={cn(
											"h-8 min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-300",
											rowTextClasses(row),
										)}
									/>
									{row.href && (
										<span
											className="flex max-w-40 shrink-0 items-center gap-1 truncate text-[11px] text-neutral-400"
											title={row.href}
										>
											<Link2 className="size-3 shrink-0" aria-hidden="true" />
											<span className="truncate">
												{row.href.replace(/^(https:\/\/|mailto:|tel:)/, "")}
											</span>
										</span>
									)}
								</div>
							)}
							{row.kind === "blank" && (
								<input
									data-row-input={row.id}
									value=""
									disabled={disabled}
									aria-label={`Blank line ${index + 1}`}
									onFocus={() => setActiveId(row.id)}
									onChange={(event) =>
										update(row.id, { ...createTextRow(event.target.value), id: row.id })
									}
									onKeyDown={(event) => onLineKeyDown(event, row)}
									className="h-8 w-full bg-transparent text-sm outline-none"
								/>
							)}
							{row.kind === "list" && (
								<ListLines
									row={row}
									disabled={disabled}
									onFocus={() => setActiveId(row.id)}
									onChange={(next) => update(row.id, next)}
									onExit={(focusItem) => {
										if (focusItem === null) {
											insertAfter(row.id, createTextRow());
										} else {
											setFocusTarget({ rowId: row.id, item: focusItem });
										}
									}}
									onRemove={() => remove(row.id)}
								/>
							)}
							{row.kind === "image" && (
								<ImageLine
									row={row}
									asset={assets.find((item) => item.contentId === row.contentId)}
									disabled={disabled}
									onSelect={() => {
										setActiveId(row.id);
										setLinkOpen(false);
									}}
								/>
							)}
							{rowIssues.map((issue) => (
								<p key={issue.message} role="alert" className="pb-1 text-xs text-red-600">
									{issue.message}
								</p>
							))}
						</div>
					);
				})}
			</div>

			<div className="flex flex-wrap items-center gap-1 border-t border-neutral-100 px-2 py-1.5">
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() => insertAfter(activeId, createTextRow())}
				>
					<Plus aria-hidden="true" />
					Line
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() =>
						insertAfter(activeId, { id: newRowId(), kind: "list", ordered: false, items: [""] }, 0)
					}
				>
					<List aria-hidden="true" />
					Bullets
				</Button>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					onClick={() =>
						insertAfter(activeId, { id: newRowId(), kind: "list", ordered: true, items: [""] }, 0)
					}
				>
					<ListOrdered aria-hidden="true" />
					Numbers
				</Button>
				{imagePicker}
			</div>
		</div>
	);
}

function LinkBar({
	row,
	disabled,
	onChange,
	onClose,
}: Readonly<{
	row: SignatureTextRow;
	disabled: boolean;
	onChange: (href: string) => void;
	onClose: () => void;
}>) {
	const [value, setValue] = useState(row.href);
	const [error, setError] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		// Opening the link bar is an explicit request to edit the link.
		inputRef.current?.focus();
	}, []);

	function apply() {
		const normalized = normalizeSignatureLink(value);
		if (normalized === null) {
			setError("Use a web address (https://), an email, or a phone number.");
			return;
		}
		onChange(normalized);
		onClose();
	}

	return (
		<div className="border-b border-neutral-100 px-3 py-2">
			<div className="flex items-center gap-2">
				<Link2 className="size-4 shrink-0 text-neutral-400" aria-hidden="true" />
				<Input
					ref={inputRef}
					value={value}
					disabled={disabled}
					aria-label="Link for this line"
					aria-invalid={!!error}
					placeholder="example.com, name@example.com, or +1 555 0100"
					onChange={(event) => {
						setValue(event.target.value);
						setError(null);
					}}
					onKeyDown={(event) => {
						if (event.key === "Enter") {
							event.preventDefault();
							apply();
						}
						if (event.key === "Escape") onClose();
					}}
					className="h-8 border-0 px-0 shadow-none focus-visible:ring-0"
				/>
				{row.href && (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => {
							onChange("");
							onClose();
						}}
					>
						Remove
					</Button>
				)}
				<Button type="button" size="xs" onClick={apply} disabled={disabled}>
					Apply
				</Button>
			</div>
			{error && (
				<p role="alert" className="mt-1 pl-6 text-xs text-red-600">
					{error}
				</p>
			)}
		</div>
	);
}

function ImageBar({
	row,
	assets,
	disabled,
	onChange,
}: Readonly<{
	row: SignatureImageRow;
	assets: SignatureAsset[];
	disabled: boolean;
	onChange: (row: SignatureImageRow) => void;
}>) {
	const asset = assets.find((item) => item.contentId === row.contentId);
	return (
		<div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 text-sm">
			<div className="flex rounded-md bg-neutral-100 p-0.5" role="group" aria-label="Image size">
				{IMAGE_SIZES.map((size) => {
					const target = asset ? scaleImage(asset, size.width) : null;
					const selected = target?.width === row.width;
					return (
						<button
							key={size.label}
							type="button"
							title={size.name}
							aria-label={`${size.name} image`}
							aria-pressed={selected}
							disabled={disabled || !target}
							onClick={() => target && onChange({ ...row, ...target })}
							className={cn(
								"h-6 min-w-7 rounded px-1.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
								selected ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500",
							)}
						>
							{size.label}
						</button>
					);
				})}
			</div>
			<Input
				value={row.decorative ? "" : row.alt}
				disabled={disabled || row.decorative}
				aria-label="Image description"
				aria-invalid={!row.decorative && !row.alt.trim()}
				placeholder={row.decorative ? "Decorative image" : "Describe the image"}
				onChange={(event) => onChange({ ...row, alt: event.target.value.slice(0, 200) })}
				className="h-8 min-w-40 flex-1"
			/>
			<label className="flex items-center gap-1.5 text-xs text-neutral-600">
				<input
					type="checkbox"
					aria-label="Decorative image"
					checked={row.decorative}
					disabled={disabled}
					onChange={(event) =>
						onChange({
							...row,
							decorative: event.target.checked,
							alt: event.target.checked ? "" : row.alt,
						})
					}
					className="size-3.5 accent-primary"
				/>
				Decorative
			</label>
		</div>
	);
}

function ListLines({
	row,
	disabled,
	onFocus,
	onChange,
	onExit,
	onRemove,
}: Readonly<{
	row: SignatureListRow;
	disabled: boolean;
	onFocus: () => void;
	onChange: (row: SignatureListRow) => void;
	/** Move focus to an item, or leave the list when `null`. */
	onExit: (focusItem: number | null) => void;
	onRemove: () => void;
}>) {
	const Tag = row.ordered ? "ol" : "ul";
	return (
		<Tag className={cn("py-0.5 pl-5 text-sm", row.ordered ? "list-decimal" : "list-disc")}>
			{row.items.map((item, index) => (
				<li key={index} className="pl-1 marker:text-neutral-400">
					<input
						data-row-input={row.id}
						data-item={index}
						value={item}
						disabled={disabled}
						placeholder="List item"
						aria-label={`${row.ordered ? "Numbered" : "Bulleted"} item ${index + 1}`}
						onFocus={onFocus}
						onChange={(event) => {
							const items = [...row.items];
							items[index] = event.target.value;
							onChange({ ...row, items });
						}}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								// Enter on an empty last item leaves the list, like most editors.
								if (!item.trim() && index === row.items.length - 1) {
									if (row.items.length === 1) onRemove();
									else onChange({ ...row, items: row.items.slice(0, -1) });
									onExit(null);
									return;
								}
								const items = [...row.items];
								items.splice(index + 1, 0, "");
								onChange({ ...row, items });
								onExit(index + 1);
							}
							if (event.key === "Backspace" && item === "") {
								event.preventDefault();
								if (row.items.length === 1) {
									onRemove();
									return;
								}
								onChange({ ...row, items: row.items.filter((_, position) => position !== index) });
								onExit(Math.max(0, index - 1));
							}
						}}
						className="h-7 w-full bg-transparent text-neutral-900 outline-none placeholder:text-neutral-300"
					/>
				</li>
			))}
		</Tag>
	);
}

function ImageLine({
	row,
	asset,
	disabled,
	onSelect,
}: Readonly<{
	row: SignatureImageRow;
	asset: SignatureAsset | undefined;
	disabled: boolean;
	onSelect: () => void;
}>) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onSelect}
			aria-label={`Image: ${row.decorative ? "decorative" : row.alt || "needs a description"}`}
			className={cn("flex w-full py-1.5 outline-none", ALIGN_CLASSES[row.align], {
				"justify-start": row.align === "left",
				"justify-center": row.align === "center",
				"justify-end": row.align === "right",
			})}
		>
			{asset ? (
				// eslint-disable-next-line @next/next/no-img-element
				<img
					src={asset.previewUrl}
					alt=""
					width={row.width}
					height={row.height}
					className="max-w-full rounded-sm object-contain"
				/>
			) : (
				<span className="rounded bg-neutral-100 px-2 py-1 text-xs text-neutral-500">
					Image unavailable
				</span>
			)}
		</button>
	);
}

type SignatureImagePickerProps = {
	assets: SignatureAsset[];
	disabled: boolean;
	referencedContentIds: Set<string>;
	onUpload: (file: File, altText: string) => Promise<SignatureAsset>;
	onInsert: (asset: SignatureAsset) => void;
	onDelete: (asset: SignatureAsset) => Promise<void>;
};

/** Upload and choose signature images without crowding the editor. */
export function SignatureImagePicker({
	assets,
	disabled,
	referencedContentIds,
	onUpload,
	onInsert,
	onDelete,
}: Readonly<SignatureImagePickerProps>) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [altText, setAltText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const totalSize = assets.reduce((total, asset) => total + asset.size, 0);
	const full = assets.length >= MAX_IMAGE_COUNT;

	function reset() {
		setFile(null);
		setAltText("");
		setError(null);
		if (inputRef.current) inputRef.current.value = "";
	}

	async function upload() {
		if (!file) return;
		setBusy(true);
		setError(null);
		try {
			await validateSignatureImage(file, assets);
			const asset = await onUpload(file, altText.trim());
			onInsert(asset);
			reset();
			setOpen(false);
		} catch (uploadError) {
			setError(uploadError instanceof Error ? uploadError.message : "Image upload failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) reset();
			}}
		>
			<DialogTrigger asChild>
				<Button type="button" variant="ghost" size="sm" disabled={disabled}>
					<ImagePlus aria-hidden="true" />
					Image
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Add an image</DialogTitle>
					<DialogDescription>
						JPEG, PNG, or GIF up to 512 KB and 1200×600. {assets.length}/{MAX_IMAGE_COUNT} used ·{" "}
						{formatBytes(totalSize)} of {formatBytes(MAX_TOTAL_IMAGE_SIZE)}
					</DialogDescription>
				</DialogHeader>
				<DialogBody className="space-y-5 pb-1">
					{assets.length > 0 && (
						<ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
							{assets.map((asset) => {
								const inUse = referencedContentIds.has(asset.contentId);
								return (
									<li key={asset.id} className="group relative">
										<button
											type="button"
											onClick={() => {
												onInsert(asset);
												setOpen(false);
											}}
											className="flex h-20 w-full items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 p-2 outline-none hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-primary/40"
											aria-label={`Insert ${asset.altText || asset.filename}`}
										>
											{/* eslint-disable-next-line @next/next/no-img-element */}
											<img
												src={asset.previewUrl}
												alt=""
												className="max-h-full max-w-full object-contain"
											/>
										</button>
										<button
											type="button"
											disabled={inUse}
											title={
												inUse
													? "In use — remove it from the signature and save first"
													: "Delete image"
											}
											aria-label={`Delete ${asset.filename}`}
											onClick={() =>
												void onDelete(asset).catch((deleteError: unknown) =>
													setError(
														deleteError instanceof Error ? deleteError.message : "Delete failed",
													),
												)
											}
											className="absolute top-1 right-1 rounded-md bg-white/90 p-1 text-neutral-500 opacity-0 shadow-sm transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-600 disabled:hidden"
										>
											<Trash2 className="size-3.5" />
										</button>
										<p className="mt-1 truncate text-xs text-neutral-500">{asset.filename}</p>
									</li>
								);
							})}
						</ul>
					)}

					<div className="space-y-2 rounded-lg border border-dashed border-neutral-300 p-3">
						<input
							ref={inputRef}
							type="file"
							accept="image/jpeg,image/png,image/gif"
							className="sr-only"
							id="signature-image-file"
							aria-label="Upload a new image"
							disabled={busy || full}
							onChange={(event) => {
								setFile(event.target.files?.[0] ?? null);
								setError(null);
							}}
						/>
						<label
							htmlFor="signature-image-file"
							className={cn(
								"flex cursor-pointer items-center gap-2 text-sm font-medium text-primary",
								(busy || full) && "pointer-events-none opacity-50",
							)}
						>
							<Upload className="size-4" aria-hidden="true" />
							{file ? file.name : full ? "Image limit reached" : "Upload a new image"}
						</label>
						{file && (
							<div className="flex flex-wrap items-center gap-2">
								<Input
									value={altText}
									onChange={(event) => setAltText(event.target.value.slice(0, 200))}
									placeholder="Describe it (leave empty if decorative)"
									aria-label="Image description"
									className="h-8 min-w-48 flex-1"
								/>
								<Button type="button" size="sm" disabled={busy} onClick={() => void upload()}>
									{busy ? "Uploading…" : "Upload and insert"}
								</Button>
							</div>
						)}
					</div>
					{error && (
						<p role="alert" className="text-sm text-red-600">
							{error}
						</p>
					)}
				</DialogBody>
			</DialogContent>
		</Dialog>
	);
}

/** How the signature will look at the bottom of an email. */
export function SignaturePreview({
	assets,
	rows,
	text,
	from,
}: Readonly<{
	assets: SignatureAsset[];
	rows: SignatureRow[];
	text: string;
	from: string;
}>) {
	const [tab, setTab] = useState<"html" | "text">("html");
	const hasContent = rows.some(
		(row) =>
			row.kind === "image" ||
			(row.kind === "text" && row.text.trim()) ||
			(row.kind === "list" && row.items.some((item) => item.trim())),
	);
	return (
		<section
			aria-label="Signature preview"
			className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
		>
			<div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-4 py-2">
				<h3 className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Preview</h3>
				<div
					className="flex rounded-md bg-neutral-100 p-0.5"
					role="tablist"
					aria-label="Preview format"
				>
					{(["html", "text"] as const).map((value) => (
						<button
							key={value}
							type="button"
							role="tab"
							aria-selected={tab === value}
							onClick={() => setTab(value)}
							className={cn(
								"rounded px-2.5 py-0.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
								tab === value ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500",
							)}
						>
							{value === "html" ? "Email" : "Plain text"}
						</button>
					))}
				</div>
			</div>
			<div role="tabpanel" className="px-4 py-3 text-sm">
				<p className="truncate text-xs text-neutral-400">From {from}</p>
				<div className="mt-3 space-y-1.5" aria-hidden="true">
					<div className="h-2 w-11/12 rounded-full bg-neutral-100" />
					<div className="h-2 w-4/5 rounded-full bg-neutral-100" />
					<div className="h-2 w-2/5 rounded-full bg-neutral-100" />
				</div>
				<div className="mt-4 min-h-16 border-t border-dashed border-neutral-200 pt-3">
					{!hasContent && <p className="text-neutral-400">No signature</p>}
					{hasContent && tab === "html" && (
						<div className="text-neutral-900">
							{rows.map((row) => (
								<PreviewRow key={row.id} row={row} assets={assets} />
							))}
						</div>
					)}
					{hasContent && tab === "text" && (
						<pre className="font-sans whitespace-pre-wrap text-neutral-800">{text}</pre>
					)}
				</div>
			</div>
		</section>
	);
}

function PreviewRow({ row, assets }: Readonly<{ row: SignatureRow; assets: SignatureAsset[] }>) {
	if (row.kind === "blank") return <div className="h-5" aria-hidden="true" />;
	if (row.kind === "list") {
		const Tag = row.ordered ? "ol" : "ul";
		return (
			<Tag className={cn("my-0 pl-5", row.ordered ? "list-decimal" : "list-disc")}>
				{row.items
					.filter((item) => item.trim())
					.map((item, index) => (
						<li key={`${row.id}-${index}`}>{item}</li>
					))}
			</Tag>
		);
	}
	if (row.kind === "image") {
		const asset = assets.find((item) => item.contentId === row.contentId);
		if (!asset) return null;
		return (
			<div className={ALIGN_CLASSES[row.align]}>
				{/* eslint-disable-next-line @next/next/no-img-element */}
				<img
					src={asset.previewUrl}
					alt={row.decorative ? "" : row.alt}
					width={row.width}
					height={row.height}
					className="inline-block max-w-full object-contain"
				/>
			</div>
		);
	}
	if (!row.text.trim()) return <div className="h-5" aria-hidden="true" />;
	let content: ReactNode = row.text;
	if (row.marks.includes("strike")) content = <s>{content}</s>;
	if (row.marks.includes("underline")) content = <u>{content}</u>;
	if (row.marks.includes("italic")) content = <em>{content}</em>;
	if (row.marks.includes("bold")) content = <strong>{content}</strong>;
	if (row.href) {
		content = (
			<a
				href={row.href}
				onClick={(event) => event.preventDefault()}
				className="text-blue-700 underline"
			>
				{content}
			</a>
		);
	}
	return (
		<p className={cn("m-0", ALIGN_CLASSES[row.align])} style={{ color: row.color || undefined }}>
			{content}
		</p>
	);
}

async function validateSignatureImage(file: File, assets: SignatureAsset[]): Promise<void> {
	if (!IMAGE_TYPES.has(file.type)) throw new Error("Choose a JPEG, PNG, or GIF image.");
	if (file.size === 0) throw new Error("The selected image is empty.");
	if (file.size > MAX_IMAGE_SIZE) throw new Error("Images must be 512 KB or smaller.");
	if (assets.length >= MAX_IMAGE_COUNT)
		throw new Error(`You can keep up to ${MAX_IMAGE_COUNT} images.`);
	if (assets.reduce((total, asset) => total + asset.size, 0) + file.size > MAX_TOTAL_IMAGE_SIZE)
		throw new Error("That would exceed the 2 MB image total.");
	const dimensions = await readImageDimensions(file);
	if (dimensions.width > MAX_IMAGE_WIDTH || dimensions.height > MAX_IMAGE_HEIGHT)
		throw new Error("Images can be at most 1200×600 pixels.");
}

function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
	return new Promise((resolve, reject) => {
		const url = URL.createObjectURL(file);
		const image = new Image();
		image.onload = () => {
			URL.revokeObjectURL(url);
			resolve({ width: image.naturalWidth, height: image.naturalHeight });
		};
		image.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error("The selected file is not a readable image."));
		};
		image.src = url;
	});
}

function formatBytes(value: number): string {
	if (value < 1024) return `${value} B`;
	if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
	return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
