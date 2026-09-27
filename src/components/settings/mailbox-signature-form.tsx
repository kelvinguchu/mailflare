"use client";

import { useEffect, useMemo, useState } from "react";
import { useSelectedMailbox } from "@/components/mailbox-provider";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { SignatureEditor, SignatureImagePicker, SignaturePreview } from "./signature-editor";
import {
	parseSignature,
	scaleImage,
	serializeSignature,
	signatureContentIds,
	signatureRowsToText,
	textToSignatureRows,
	validateSignatureRows,
	type SignatureRow,
} from "./signature-model";
import type { MailboxSignatureValue, SignatureAsset } from "./types";
import {
	deleteSignatureAsset,
	listSignatureAssets,
	updateMailboxSignature,
	uploadSignatureAsset,
} from "./utils";

type EditorMode = "rich" | "plain";

export function MailboxSignatureForm() {
	const { selectedMailbox, setSelectedMailbox, isLoading } = useSelectedMailbox();
	const [mode, setMode] = useState<EditorMode>("plain");
	const [rows, setRows] = useState<SignatureRow[]>([]);
	const [savedRows, setSavedRows] = useState<SignatureRow[]>([]);
	const [plainText, setPlainText] = useState("");
	const [saved, setSaved] = useState<MailboxSignatureValue>(emptySignature());
	const [assets, setAssets] = useState<SignatureAsset[]>([]);
	const [assetsLoading, setAssetsLoading] = useState(false);
	const [unsupportedHtml, setUnsupportedHtml] = useState(false);
	const [replaceUnsupportedHtml, setReplaceUnsupportedHtml] = useState(false);
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const mailboxId = selectedMailbox?.id;
	const mailboxSignature = selectedMailbox?.signature;
	const mailboxSignatureHtml = selectedMailbox?.signatureHtml;
	const mailboxSignatureText = selectedMailbox?.signatureText;
	const mailboxSignatureVersion = selectedMailbox?.signatureVersion;

	useEffect(() => {
		if (!mailboxId) return;
		const value: MailboxSignatureValue = {
			signature: mailboxSignature ?? null,
			signatureText: mailboxSignatureText ?? mailboxSignature ?? null,
			signatureHtml: mailboxSignatureHtml ?? null,
			signatureVersion: mailboxSignatureVersion ?? 0,
		};
		const parsed = value.signatureHtml
			? parseSignature(value.signatureHtml, new DOMParser())
			: textToSignatureRows(value.signatureText);
		const editableRows = parsed ?? textToSignatureRows(value.signatureText);
		setSaved(value);
		setRows(editableRows);
		setSavedRows(parsed ?? []);
		setPlainText(value.signatureText ?? "");
		setMode(value.signatureHtml ? "rich" : "plain");
		setUnsupportedHtml(Boolean(value.signatureHtml && !parsed));
		setReplaceUnsupportedHtml(false);
		setStatus(null);
	}, [
		mailboxId,
		mailboxSignature,
		mailboxSignatureHtml,
		mailboxSignatureText,
		mailboxSignatureVersion,
	]);

	useEffect(() => {
		if (!mailboxId) return;
		let cancelled = false;
		setAssets([]);
		setAssetsLoading(true);
		listSignatureAssets(mailboxId)
			.then((items) => {
				if (!cancelled) setAssets(items);
			})
			.catch((error) => {
				if (!cancelled)
					setStatus(error instanceof Error ? error.message : "Failed to load signature images");
			})
			.finally(() => {
				if (!cancelled) setAssetsLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [mailboxId]);

	const issues = useMemo(() => validateSignatureRows(rows), [rows]);
	const richHtml = serializeSignature(rows);
	const richText = signatureRowsToText(rows) || null;
	const richChanged = richHtml !== saved.signatureHtml || richText !== saved.signatureText;
	const plainChanged =
		normalizeText(plainText) !== saved.signatureText || saved.signatureHtml !== null;
	const changed = mode === "rich" ? richChanged : plainChanged;
	const referencedContentIds = useMemo(
		() => new Set([...signatureContentIds(rows), ...signatureContentIds(savedRows)]),
		[rows, savedRows],
	);

	async function onSubmit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		if (!selectedMailbox) return;
		if (mode === "rich" && unsupportedHtml && !replaceUnsupportedHtml) {
			setStatus("Choose “Rebuild in editor” first.");
			return;
		}
		if (mode === "rich" && issues.length > 0) {
			setStatus("Fix the highlighted lines first.");
			return;
		}
		setSaving(true);
		setStatus(null);
		try {
			const result = await updateMailboxSignature(
				selectedMailbox.id,
				mode === "rich"
					? { mode: "rich", signatureHtml: richHtml, signatureText: richText }
					: { mode: "plain", signature: plainText },
			);
			const canonicalRows = result.signatureHtml
				? parseSignature(result.signatureHtml, new DOMParser())
				: textToSignatureRows(result.signatureText);
			if (!canonicalRows)
				throw new Error("The saved signature could not be reopened by the editor");
			setSaved(result);
			setRows(canonicalRows);
			setSavedRows(canonicalRows);
			setPlainText(result.signatureText ?? "");
			setUnsupportedHtml(false);
			setReplaceUnsupportedHtml(false);
			setSelectedMailbox({
				...selectedMailbox,
				signature: result.signature,
				signatureText: result.signatureText,
				signatureHtml: result.signatureHtml,
				signatureVersion: result.signatureVersion,
			});
			setStatus("Saved");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Failed to update signature");
		} finally {
			setSaving(false);
		}
	}

	async function upload(file: File, altText: string): Promise<SignatureAsset> {
		if (!selectedMailbox) throw new Error("Select an inbox first");
		const asset = await uploadSignatureAsset(selectedMailbox.id, file, altText);
		setAssets((current) => [...current, asset]);
		return asset;
	}

	function insertAsset(asset: SignatureAsset) {
		const dimensions = scaleImage(asset, 320);
		setRows((current) => [
			...current,
			{
				id: `image-${asset.id}-${Date.now()}`,
				kind: "image",
				contentId: asset.contentId,
				alt: asset.altText,
				decorative: !asset.altText,
				align: "left",
				...dimensions,
			},
		]);
	}

	async function deleteAsset(asset: SignatureAsset) {
		if (!selectedMailbox) return;
		await deleteSignatureAsset(selectedMailbox.id, asset.id);
		setAssets((current) => current.filter((item) => item.id !== asset.id));
	}

	if (isLoading) return <p className="text-sm text-neutral-500">Loading inbox…</p>;
	if (!selectedMailbox)
		return <p className="text-sm text-neutral-500">Select an inbox to configure its signature.</p>;

	const address = `${selectedMailbox.localPart}@${selectedMailbox.hostname}`;
	const canManage = selectedMailbox.permission === "full_access";
	const controlsDisabled = !canManage || saving;
	const previewRows = mode === "rich" ? rows : textToSignatureRows(plainText);
	const previewText = mode === "rich" ? (richText ?? "") : plainText;
	const editingLocked = mode === "rich" && unsupportedHtml && !replaceUnsupportedHtml;
	const blocked = mode === "rich" && (issues.length > 0 || editingLocked);

	return (
		<form onSubmit={onSubmit} className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="min-w-0 truncate text-sm text-neutral-600">
					For <span className="font-medium text-neutral-900">{address}</span>
				</p>
				<div
					className="flex rounded-lg bg-neutral-100 p-0.5"
					role="radiogroup"
					aria-label="Signature format"
				>
					{(
						[
							{ value: "rich", label: "Formatted" },
							{ value: "plain", label: "Plain text" },
						] as const
					).map((option) => (
						<button
							key={option.value}
							type="button"
							role="radio"
							aria-checked={mode === option.value}
							disabled={controlsDisabled}
							onClick={() => setMode(option.value)}
							className={cn(
								"rounded-md px-3 py-1 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50",
								mode === option.value
									? "bg-white text-neutral-900 shadow-sm"
									: "text-neutral-500 hover:text-neutral-800",
							)}
						>
							{option.label}
						</button>
					))}
				</div>
			</div>

			<div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,1fr)] lg:items-start">
				<div className="min-w-0 space-y-2">
					{editingLocked && (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
							<span>This signature uses formatting the editor can’t change.</span>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setReplaceUnsupportedHtml(true)}
								disabled={controlsDisabled}
							>
								Rebuild in editor
							</Button>
						</div>
					)}
					{mode === "rich" && !editingLocked && (
						<SignatureEditor
							key={mailboxId}
							rows={rows}
							assets={assets}
							issues={issues}
							disabled={controlsDisabled}
							onChange={setRows}
							imagePicker={
								<SignatureImagePicker
									assets={assets}
									disabled={controlsDisabled || assetsLoading}
									referencedContentIds={referencedContentIds}
									onUpload={upload}
									onInsert={insertAsset}
									onDelete={deleteAsset}
								/>
							}
						/>
					)}
					{mode === "plain" && (
						<>
							<Textarea
								id="mailboxSignaturePlainText"
								aria-label="Plain-text signature"
								value={plainText}
								onChange={(event) => setPlainText(event.target.value)}
								placeholder={"Your name\nRole · Company\nPhone"}
								rows={8}
								disabled={controlsDisabled}
								className="min-h-44"
							/>
							{saved.signatureHtml && (
								<p className="text-xs text-amber-700">
									Saving as plain text removes formatting and images.
								</p>
							)}
						</>
					)}
				</div>

				<div className="space-y-2 lg:sticky lg:top-4">
					<SignaturePreview assets={assets} rows={previewRows} text={previewText} from={address} />
					<p className="px-1 text-xs text-neutral-500">
						Added to new messages, replies, and forwards.
					</p>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-3 border-t border-neutral-100 pt-4">
				<Button type="submit" disabled={!canManage || saving || !changed || blocked}>
					{saving ? "Saving…" : "Save signature"}
				</Button>
				{changed && !saving && (
					<Button
						type="button"
						variant="ghost"
						onClick={() => {
							setRows(savedRows.length ? savedRows : textToSignatureRows(saved.signatureText));
							setPlainText(saved.signatureText ?? "");
							setMode(saved.signatureHtml ? "rich" : "plain");
							setStatus(null);
						}}
					>
						Discard
					</Button>
				)}
				<p role="status" aria-live="polite" className="text-sm text-neutral-500">
					{canManage ? status : "You need full access to edit this signature."}
				</p>
			</div>
		</form>
	);
}

function emptySignature(): MailboxSignatureValue {
	return { signature: null, signatureText: null, signatureHtml: null, signatureVersion: 0 };
}

function normalizeText(value: string): string | null {
	return value.trim() || null;
}
