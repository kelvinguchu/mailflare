"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { OneTimeCodeInput } from "@/components/auth/one-time-code-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MfaQrCode } from "./mfa-qr-code";
import {
	describeMfaError,
	formatSetupKey,
	isSixDigitCode,
	loadMfaStatus,
	MfaRequestError,
	normalizeTotpCode,
	requestMfa,
} from "./mfa-utils";
import { RecoveryCodesPanel } from "./recovery-codes-panel";
import type { MfaRequestContext, MfaSetupDetails, MfaStatus } from "./types";

type RecoveryState = { codes: string[]; reason: "enabled" | "replaced" };

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function MfaSettings({ enrollmentMode = false }: Readonly<{ enrollmentMode?: boolean }>) {
	const router = useRouter();
	const [status, setStatus] = useState<MfaStatus | null>(null);
	const [statusError, setStatusError] = useState<string | null>(null);
	const [setup, setSetup] = useState<MfaSetupDetails | null>(null);
	const [recovery, setRecovery] = useState<RecoveryState | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refreshStatus = useCallback(async () => {
		try {
			setStatus(await loadMfaStatus());
			setStatusError(null);
		} catch (reason) {
			setStatusError(describeMfaError(reason, "status"));
		}
	}, []);

	useEffect(() => {
		void refreshStatus();
	}, [refreshStatus]);

	useEffect(() => {
		// Another tab or an administrator may change MFA or policy while this page is open.
		// Never refresh while one-time recovery codes are on screen.
		if (recovery) return;
		const onVisible = () => {
			if (document.visibilityState === "visible") void refreshStatus();
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => document.removeEventListener("visibilitychange", onVisible);
	}, [recovery, refreshStatus]);

	useEffect(() => {
		// Enabled elsewhere: an in-progress setup key is no longer usable.
		if (status?.enabled && setup) {
			setSetup(null);
			setNotice("Multi-factor authentication was enabled in another window.");
		}
	}, [setup, status?.enabled]);

	if (recovery) {
		return (
			<RecoveryCodesPanel
				codes={recovery.codes}
				title={
					recovery.reason === "enabled"
						? "Multi-factor authentication is on. Save your recovery codes."
						: "Your new recovery codes"
				}
				description={
					recovery.reason === "enabled"
						? "If you lose your authenticator, each code lets you sign in once. They won’t be shown again."
						: "Your previous recovery codes no longer work. These won’t be shown again."
				}
				continueLabel={enrollmentMode ? "Continue to CC Mail" : "Done"}
				onContinue={() => {
					setRecovery(null);
					if (enrollmentMode) {
						router.replace("/inbox");
						router.refresh();
					} else {
						void refreshStatus();
					}
				}}
			/>
		);
	}

	if (!status) {
		return statusError ? (
			<div role="alert" className="space-y-3 text-sm text-red-700">
				<p>{statusError}</p>
				<Button type="button" variant="outline" onClick={() => void refreshStatus()}>
					Try again
				</Button>
			</div>
		) : (
			<p role="status" className="text-sm text-neutral-500">
				Loading security settings…
			</p>
		);
	}

	return (
		<div className="space-y-6">
			<PolicyNotice status={status} />
			{notice && (
				<p role="status" className="text-sm font-medium text-neutral-700">
					{notice}
				</p>
			)}

			<div className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
				<p className="font-medium text-neutral-900">{status.enabled ? "Enabled" : "Not enabled"}</p>
				<p className="mt-1 text-neutral-600">
					{status.enabled
						? `${status.recoveryCodesRemaining} unused recovery ${status.recoveryCodesRemaining === 1 ? "code remains" : "codes remain"}.`
						: "Sign-in currently relies on your password alone."}
				</p>
			</div>

			{!status.enabled && !setup && (
				<BeginSetupForm
					onStarted={(details) => {
						setNotice(null);
						setSetup(details);
					}}
					onAlreadyEnabled={() => void refreshStatus()}
				/>
			)}

			{!status.enabled && setup && (
				<VerifySetupForm
					setup={setup}
					onCancel={() => setSetup(null)}
					onExpired={() => {
						setSetup(null);
						setNotice("Your setup key expired. Enter your password to get a new one.");
					}}
					onEnabled={(codes) => {
						setSetup(null);
						setRecovery({ codes, reason: "enabled" });
					}}
				/>
			)}

			{status.enabled && !enrollmentMode && (
				<>
					<ProtectedActionForm
						title="Replace recovery codes"
						description="Creates a new set and invalidates every existing recovery code."
						submitLabel="Generate new codes"
						method="PATCH"
						onSuccess={(codes) => setRecovery({ codes: codes ?? [], reason: "replaced" })}
					/>
					{(!status.policy.required || status.policy.state === "exempt") && (
						<ProtectedActionForm
							title="Turn off multi-factor authentication"
							description="Your account will be protected by your password alone."
							submitLabel="Turn off MFA"
							method="DELETE"
							destructive
							onSuccess={() => {
								setNotice("Multi-factor authentication is turned off.");
								void refreshStatus();
							}}
						/>
					)}
				</>
			)}
		</div>
	);
}

function PolicyNotice({ status }: Readonly<{ status: MfaStatus }>) {
	const { policy } = status;
	if (policy.state === "grace" && policy.deadline) {
		return (
			<p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
				Workspace policy requires multi-factor authentication by{" "}
				{dateTime.format(new Date(policy.deadline))}.
			</p>
		);
	}
	if (policy.state === "restricted") {
		return (
			<p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
				Workspace access is limited to security setup until you turn on multi-factor authentication.
			</p>
		);
	}
	if (policy.state === "exempt" && policy.exemptUntil) {
		return (
			<p className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
				A temporary policy exception is active until {dateTime.format(new Date(policy.exemptUntil))}
				.
			</p>
		);
	}
	return null;
}

/** Runs one request at a time and keeps the error next to the field that caused it. */
function useMfaAction(context: MfaRequestContext) {
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const run = useCallback(
		async <T,>(action: () => Promise<T>): Promise<T | null> => {
			setPending(true);
			setError(null);
			try {
				return await action();
			} catch (reason) {
				setError(describeMfaError(reason, context));
				throw reason;
			} finally {
				setPending(false);
			}
		},
		[context],
	);
	return { pending, error, setError, run };
}

function FieldError({ id, message }: Readonly<{ id: string; message: string | null }>) {
	if (!message) return null;
	return (
		<p id={id} role="alert" className="text-sm font-medium text-red-700">
			{message}
		</p>
	);
}

function BeginSetupForm({
	onStarted,
	onAlreadyEnabled,
}: Readonly<{ onStarted: (details: MfaSetupDetails) => void; onAlreadyEnabled: () => void }>) {
	const id = useId();
	const passwordRef = useRef<HTMLInputElement>(null);
	const { pending, error, run } = useMfaAction("begin");

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const password = String(new FormData(event.currentTarget).get("currentPassword") ?? "");
				void run(() => requestMfa<MfaSetupDetails>("POST", { currentPassword: password }))
					.then((details) => details && onStarted(details))
					.catch((reason: unknown) => {
						if (reason instanceof MfaRequestError && reason.status === 409) onAlreadyEnabled();
						passwordRef.current?.focus();
					});
			}}
			className="space-y-3 rounded-2xl border border-neutral-200 p-4"
		>
			<div>
				<h3 className="text-sm font-medium text-neutral-900">
					Turn on multi-factor authentication
				</h3>
				<p className="mt-1 text-sm text-neutral-600">
					Confirm your password to create a key for your authenticator app.
				</p>
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-password`}>Current password</Label>
				<Input
					ref={passwordRef}
					id={`${id}-password`}
					name="currentPassword"
					type="password"
					autoComplete="current-password"
					required
					aria-invalid={!!error}
					aria-describedby={error ? `${id}-error` : undefined}
				/>
			</div>
			<FieldError id={`${id}-error`} message={error} />
			<Button type="submit" disabled={pending}>
				{pending ? "Creating key…" : "Create authenticator key"}
			</Button>
		</form>
	);
}

function VerifySetupForm({
	setup,
	onCancel,
	onExpired,
	onEnabled,
}: Readonly<{
	setup: MfaSetupDetails;
	onCancel: () => void;
	onExpired: () => void;
	onEnabled: (codes: string[]) => void;
}>) {
	const id = useId();
	const headingRef = useRef<HTMLHeadingElement>(null);
	const codeRef = useRef<HTMLInputElement>(null);
	const [code, setCode] = useState("");
	const [keyStatus, setKeyStatus] = useState("");
	const { pending, error, setError, run } = useMfaAction("verify");

	useEffect(() => {
		headingRef.current?.focus();
	}, []);

	async function copyKey() {
		try {
			await navigator.clipboard.writeText(setup.secret);
			setKeyStatus("Setup key copied.");
		} catch {
			setKeyStatus("Copying isn’t available here. Type the key into your app instead.");
		}
	}

	return (
		<section
			aria-labelledby={`${id}-heading`}
			className="space-y-5 rounded-2xl border border-neutral-200 p-4 sm:p-5"
		>
			<div>
				<h3
					id={`${id}-heading`}
					ref={headingRef}
					tabIndex={-1}
					className="text-base font-semibold text-neutral-900 outline-none"
				>
					Set up your authenticator app
				</h3>
				<p className="mt-1 text-sm text-neutral-600">
					Use an app such as Google Authenticator, Microsoft Authenticator, or 1Password.
				</p>
			</div>

			<ol className="space-y-5">
				<li className="space-y-3">
					<p className="text-sm font-medium text-neutral-900">1. Scan this QR code</p>
					<div className="flex flex-col gap-4 sm:flex-row sm:items-start">
						<MfaQrCode otpauthUri={setup.otpauthUri} />
						<div className="min-w-0 space-y-2 text-sm">
							<p className="text-neutral-600">Can’t scan it? Enter this setup key in the app:</p>
							<code
								id={`${id}-key`}
								className="block rounded-xl bg-neutral-100 px-3 py-2 font-mono text-sm tracking-wider break-all text-neutral-900 select-all"
							>
								{formatSetupKey(setup.secret)}
							</code>
							<Button type="button" variant="outline" size="sm" onClick={() => void copyKey()}>
								Copy setup key
							</Button>
							<p role="status" aria-live="polite" className="min-h-5 text-xs text-neutral-600">
								{keyStatus}
							</p>
						</div>
					</div>
				</li>
				<li>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							if (!isSixDigitCode(code)) {
								setError("Enter the six-digit code shown in your authenticator app.");
								codeRef.current?.focus();
								return;
							}
							void run(() =>
								requestMfa<{ recoveryCodes: string[] }>("PUT", { code: normalizeTotpCode(code) }),
							)
								.then((result) => result && onEnabled(result.recoveryCodes))
								.catch((reason: unknown) => {
									if (reason instanceof MfaRequestError && reason.status === 409) {
										onExpired();
										return;
									}
									setCode("");
									codeRef.current?.focus();
								});
						}}
						className="space-y-3"
					>
						<Label htmlFor={`${id}-code`} className="text-sm font-medium text-neutral-900">
							2. Enter the six-digit code from the app
						</Label>
						<OneTimeCodeInput
							id={`${id}-code`}
							inputRef={codeRef}
							value={code}
							onChange={(next) => {
								setCode(next);
								setError(null);
							}}
							invalid={!!error}
							describedBy={error ? `${id}-code-error` : undefined}
						/>
						<FieldError id={`${id}-code-error`} message={error} />
						<div className="flex flex-wrap gap-2">
							<Button type="submit" disabled={pending}>
								{pending ? "Verifying…" : "Verify and turn on"}
							</Button>
							<Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>
								Cancel setup
							</Button>
						</div>
					</form>
				</li>
			</ol>
		</section>
	);
}

function ProtectedActionForm({
	title,
	description,
	submitLabel,
	method,
	destructive = false,
	onSuccess,
}: Readonly<{
	title: string;
	description: string;
	submitLabel: string;
	method: "PATCH" | "DELETE";
	destructive?: boolean;
	onSuccess: (codes?: string[]) => void;
}>) {
	const id = useId();
	const passwordRef = useRef<HTMLInputElement>(null);
	const codeRef = useRef<HTMLInputElement>(null);
	const { pending, error, run } = useMfaAction("protected");

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const form = event.currentTarget;
				const data = new FormData(form);
				void run(() =>
					requestMfa<{ recoveryCodes?: string[] }>(method, {
						currentPassword: String(data.get("currentPassword") ?? ""),
						code: String(data.get("code") ?? "").trim(),
					}),
				)
					.then((result) => {
						form.reset();
						if (result) onSuccess(result.recoveryCodes);
					})
					.catch((reason: unknown) => {
						const codeProblem =
							reason instanceof MfaRequestError && reason.message === "Invalid verification code";
						(codeProblem ? codeRef : passwordRef).current?.focus();
					});
			}}
			className="space-y-3 rounded-2xl border border-neutral-200 p-4"
		>
			<div>
				<h3 className="text-sm font-medium text-neutral-900">{title}</h3>
				<p className="mt-1 text-sm text-neutral-600">{description}</p>
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-password`}>Current password</Label>
				<Input
					ref={passwordRef}
					id={`${id}-password`}
					name="currentPassword"
					type="password"
					autoComplete="current-password"
					required
					aria-describedby={error ? `${id}-error` : undefined}
				/>
			</div>
			<div className="space-y-2">
				<Label htmlFor={`${id}-code`}>Authenticator or recovery code</Label>
				{/* Recovery codes can contain letters, so this field is not numeric-only. */}
				<Input
					ref={codeRef}
					id={`${id}-code`}
					name="code"
					type="text"
					autoComplete="one-time-code"
					autoCapitalize="off"
					spellCheck={false}
					required
					aria-describedby={error ? `${id}-error` : undefined}
				/>
			</div>
			<FieldError id={`${id}-error`} message={error} />
			<Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
				{pending ? "Confirming…" : submitLabel}
			</Button>
		</form>
	);
}
