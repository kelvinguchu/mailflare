"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { buildRecoveryCodesText } from "./mfa-utils";

/**
 * Shows one-time recovery codes until the user confirms they saved them. Codes live only in
 * component state: never in storage, URLs, or query caches.
 */
export function RecoveryCodesPanel({
	codes,
	title,
	description,
	continueLabel,
	onContinue,
}: Readonly<{
	codes: string[];
	title: string;
	description: string;
	continueLabel: string;
	onContinue: () => void;
}>) {
	const headingRef = useRef<HTMLHeadingElement>(null);
	const acknowledgementId = useId();
	const [saved, setSaved] = useState(false);
	const [status, setStatus] = useState("");

	useEffect(() => {
		headingRef.current?.focus();
	}, []);

	useEffect(() => {
		if (saved) return;
		// Leaving before saving would lose codes that can't be shown again.
		const warn = (event: BeforeUnloadEvent) => event.preventDefault();
		window.addEventListener("beforeunload", warn);
		return () => window.removeEventListener("beforeunload", warn);
	}, [saved]);

	async function copyCodes() {
		try {
			await navigator.clipboard.writeText(codes.join("\n"));
			setStatus("Recovery codes copied to the clipboard.");
		} catch {
			setStatus("Copying isn’t available here. Download the codes or write them down instead.");
		}
	}

	function downloadCodes() {
		const url = URL.createObjectURL(
			new Blob([buildRecoveryCodesText(codes)], { type: "text/plain;charset=utf-8" }),
		);
		const link = document.createElement("a");
		link.href = url;
		link.download = "cc-mail-recovery-codes.txt";
		link.click();
		URL.revokeObjectURL(url);
		setStatus("Recovery codes downloaded.");
	}

	return (
		<section
			aria-labelledby={`${acknowledgementId}-heading`}
			className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5"
		>
			<div>
				<h3
					id={`${acknowledgementId}-heading`}
					ref={headingRef}
					tabIndex={-1}
					className="text-base font-semibold text-amber-950 outline-none"
				>
					{title}
				</h3>
				<p className="mt-1 text-sm text-amber-950/80">{description}</p>
			</div>
			<ol
				aria-label="Recovery codes"
				className="grid gap-2 rounded-xl bg-white p-3 font-mono text-sm text-neutral-900 sm:grid-cols-2"
			>
				{codes.map((code) => (
					<li key={code} className="select-all">
						{code}
					</li>
				))}
			</ol>
			<div className="flex flex-wrap gap-2">
				<Button type="button" variant="outline" onClick={() => void copyCodes()}>
					<Copy aria-hidden="true" />
					Copy codes
				</Button>
				<Button type="button" variant="outline" onClick={downloadCodes}>
					<Download aria-hidden="true" />
					Download as text
				</Button>
			</div>
			<p role="status" aria-live="polite" className="min-h-5 text-sm text-amber-950">
				{status}
			</p>
			<label
				htmlFor={`${acknowledgementId}-saved`}
				className="flex cursor-pointer items-start gap-3 rounded-xl bg-white/70 p-3 text-sm text-neutral-900"
			>
				<Checkbox
					id={`${acknowledgementId}-saved`}
					checked={saved}
					onCheckedChange={(checked) => setSaved(checked === true)}
					className="mt-0.5"
					data-testid="recovery-codes-saved"
				/>
				<span>
					I saved these recovery codes somewhere safe. I understand they won’t be shown again.
				</span>
			</label>
			<Button type="button" disabled={!saved} onClick={onContinue}>
				{continueLabel}
			</Button>
		</section>
	);
}
