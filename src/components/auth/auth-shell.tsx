"use client";

import { useState } from "react";
import { useBranding } from "@/components/branding-provider";
import type { AuthShellProps } from "./types";

/**
 * Brand-panel motif: an orthogonal routing graph. Deliberately geometric and
 * flat so it reads as infrastructure tooling rather than consumer webmail.
 */
function RoutingMotif() {
	return (
		<svg
			aria-hidden="true"
			className="absolute inset-0 h-full w-full"
			preserveAspectRatio="xMidYMid slice"
			viewBox="0 0 400 600"
			fill="none"
		>
			<defs>
				<pattern id="auth-grid" width="32" height="32" patternUnits="userSpaceOnUse">
					<path d="M32 0H0V32" stroke="#ffffff" strokeOpacity="0.06" strokeWidth="1" />
				</pattern>
			</defs>
			<rect width="400" height="600" fill="url(#auth-grid)" />

			{/* Inbound trunk fanning out to mailbox endpoints. */}
			<g stroke="#ffffff" strokeOpacity="0.28" strokeWidth="1.5" strokeLinecap="square">
				<path d="M64 108H208V236" />
				<path d="M64 108V364H176" />
				<path d="M208 236H336" />
				<path d="M176 364V492H336" />
				<path d="M208 236V300H272V428" />
			</g>

			<g stroke="#e8862a" strokeOpacity="0.85" strokeWidth="2" strokeLinecap="square">
				<path d="M64 108H208V236H336" />
			</g>

			<g fill="#0f2743" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="1.5">
				<rect x="170" y="358" width="12" height="12" />
				<rect x="266" y="422" width="12" height="12" />
				<rect x="330" y="486" width="12" height="12" />
			</g>
			<g fill="#e8862a">
				<rect x="58" y="102" width="12" height="12" />
				<rect x="202" y="230" width="12" height="12" />
				<rect x="330" y="230" width="12" height="12" />
			</g>
		</svg>
	);
}

export function AuthShell({
	icon: Icon,
	title,
	description,
	children,
	footer,
	steps,
}: AuthShellProps) {
	const branding = useBranding();
	const [logoFailed, setLogoFailed] = useState(false);

	return (
		<div
			data-auth-shell
			className="grid min-h-dvh bg-[#f4f1e9] text-[#2f2a23] lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]"
		>
			{/* Accent rule stands in for the brand panel on small screens. */}
			<div className="h-1 bg-[#e8862a] lg:hidden" />

			<section className="flex min-w-0 flex-col justify-center px-6 py-12 sm:px-10 lg:px-16 lg:py-14">
				<div className="flex items-center">
					{logoFailed ? (
						<Icon className="h-8 w-8 text-[#16304e]" />
					) : (
						<img
							src="/ccmail_logo_full.png"
							onError={() => setLogoFailed(true)}
							alt={branding.appName}
							className="h-9 w-auto max-w-40 object-contain object-left"
						/>
					)}
				</div>

				<div className="mt-12 w-full max-w-[26rem]">
					{steps && (
						<ol className="mb-8 flex flex-wrap items-center gap-x-3 gap-y-2 font-mono text-[0.6875rem] uppercase tracking-[0.14em]">
							{steps.map((step, index) => (
								<li key={step.label} className="flex items-center gap-3">
									<span className={step.active ? "text-[#c96a15]" : "text-[#a89c8b]"}>
										<span
											className={
												step.active
													? "mr-2 inline-block border-b-2 border-[#e8862a] pb-0.5"
													: "mr-2 inline-block pb-0.5"
											}
										>
											{String(index + 1).padStart(2, "0")}
										</span>
										{step.label}
									</span>
									{index < steps.length - 1 && (
										<span aria-hidden="true" className="text-[#cdc2b0]">
											—
										</span>
									)}
								</li>
							))}
						</ol>
					)}

					<h1 className="text-[1.75rem] font-semibold leading-[1.15] tracking-[-0.02em] text-[#16304e] sm:text-[2.125rem]">
						{title}
					</h1>
					{description && (
						<p className="mt-3 max-w-[24rem] text-[0.9375rem] leading-6 text-[#6c6353]">
							{description}
						</p>
					)}

					<div className="mt-8 w-full">{children}</div>

					{footer && (
						<div className="mt-8 border-t border-[#e0d9cb] pt-5 text-sm text-[#6c6353]">
							{footer}
						</div>
					)}
				</div>
			</section>

			<aside className="relative hidden overflow-hidden bg-[#16304e] lg:block">
				<RoutingMotif />
			</aside>
		</div>
	);
}
