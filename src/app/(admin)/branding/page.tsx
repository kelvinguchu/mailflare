"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ImagePlus, Palette } from "lucide-react";
import { useBranding } from "@/components/branding-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRANDING_ICON_ACCEPT, saveBranding } from "./utils";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export default function BrandingPage() {
	const branding = useBranding();
	const [appName, setAppName] = useState(branding.appName);
	const [companyName, setCompanyName] = useState(branding.companyName);
	const [icon, setIcon] = useState<File | null>(null);
	const [preview, setPreview] = useState<string | null>(null);
	const [status, setStatus] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const inputRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		setAppName(branding.appName);
		setCompanyName(branding.companyName);
	}, [branding.appName, branding.companyName]);

	function pickIcon(file: File | null) {
		setIcon(file);
		if (preview) URL.revokeObjectURL(preview);
		setPreview(file ? URL.createObjectURL(file) : null);
	}

	async function submit(event: React.SubmitEvent<HTMLFormElement>) {
		event.preventDefault();
		setSaving(true);
		setStatus(null);
		try {
			await saveBranding(appName.trim(), companyName.trim(), icon);
			await branding.refreshBranding();
			setIcon(null);
			setStatus("Branding updated");
		} catch (error) {
			setStatus(error instanceof Error ? error.message : "Unable to save branding");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="space-y-6">
			<AdminPageHeader title="Branding" />
			<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
				<Card className="rounded-3xl border-0 bg-white p-6">
					<CardHeader className="py-0">
						<CardTitle className="flex items-center gap-2">
							<Palette className="h-5 w-5" />
							App identity
						</CardTitle>
						<CardDescription>
							The icon is used throughout the app; the browser favicon is managed separately.
						</CardDescription>
					</CardHeader>
					<CardContent className="pt-6">
						<form onSubmit={submit} className="space-y-6">
							<div className="space-y-2">
								<Label htmlFor="appName">App name</Label>
								<Input
									id="appName"
									value={appName}
									maxLength={60}
									onChange={(event) => setAppName(event.target.value)}
									required
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="companyName">Company name</Label>
								<Input
									id="companyName"
									value={companyName}
									maxLength={100}
									onChange={(event) => setCompanyName(event.target.value)}
									placeholder="CaliberCode"
								/>
								<p className="text-xs text-neutral-500">
									Used to suggest sender names such as John Doe from CaliberCode.
								</p>
							</div>
							<div className="space-y-2">
								<Label>App icon</Label>
								<Input
									ref={inputRef}
									type="file"
									accept={BRANDING_ICON_ACCEPT}
									className="hidden"
									onChange={(event) => pickIcon(event.target.files?.[0] ?? null)}
								/>
								<button
									type="button"
									onClick={() => inputRef.current?.click()}
									className="flex items-center gap-4 rounded-2xl border border-dashed border-neutral-300 p-4 text-left hover:bg-neutral-50"
								>
									<Image
										src={preview ?? branding.iconUrl}
										alt="App icon preview"
										width={64}
										height={64}
										unoptimized
										className="h-16 w-16 rounded-2xl object-cover"
									/>
									<span className="text-sm text-neutral-600">
										<ImagePlus className="mb-1 h-5 w-5" />
										Choose PNG, JPEG, WebP, or GIF
										<br />
										<span className="text-xs text-neutral-400">Maximum 2 MB</span>
									</span>
								</button>
							</div>
							{status && <p className="text-sm text-neutral-600">{status}</p>}
							<Button type="submit" disabled={saving || !appName.trim()}>
								{saving ? "Saving..." : "Save branding"}
							</Button>
						</form>
					</CardContent>
				</Card>
				<BrandingPreview
					iconUrl={preview ?? branding.iconUrl}
					appName={appName.trim() || "App name"}
					companyName={companyName.trim()}
				/>
			</div>
		</div>
	);
}

function BrandingPreview({
	iconUrl,
	appName,
	companyName,
}: Readonly<{ iconUrl: string; appName: string; companyName: string }>) {
	return (
		<section aria-label="Preview" className="space-y-3 rounded-3xl bg-white p-6">
			<h2 className="text-sm font-medium text-neutral-900">Preview</h2>
			<div className="overflow-hidden rounded-2xl border border-neutral-200">
				<div className="flex items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2">
					<span className="flex max-w-56 items-center gap-2 rounded-t-lg bg-white px-3 py-1.5 text-xs text-neutral-700">
						<Image
							src={iconUrl}
							alt=""
							width={16}
							height={16}
							unoptimized
							className="size-4 rounded object-cover"
						/>
						<span className="truncate">Inbox · {appName}</span>
					</span>
				</div>
				<div className="flex min-h-40 bg-[#f6f8fc]">
					<div className="w-48 space-y-2 p-3">
						<div className="flex items-center gap-2 px-1 py-1">
							<Image
								src={iconUrl}
								alt=""
								width={32}
								height={32}
								unoptimized
								className="size-8 rounded-lg object-cover"
							/>
							<span className="truncate text-sm font-semibold text-neutral-900">{appName}</span>
						</div>
						<div className="h-7 rounded-full bg-primary/10" />
						<div className="h-3 w-24 rounded bg-neutral-200" />
						<div className="h-3 w-20 rounded bg-neutral-200" />
					</div>
					<div className="mt-3 flex-1 rounded-tl-2xl bg-white p-4">
						<div className="h-3 w-40 rounded bg-neutral-200" />
						<div className="mt-3 h-3 w-56 rounded bg-neutral-100" />
						<div className="mt-3 h-3 w-48 rounded bg-neutral-100" />
					</div>
				</div>
			</div>
			{companyName && (
				<p className="text-xs text-neutral-500">
					Sender name suggestion:{" "}
					<span className="text-neutral-800">Jane Doe from {companyName}</span>
				</p>
			)}
		</section>
	);
}
