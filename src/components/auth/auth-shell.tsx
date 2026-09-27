"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { useBranding } from "@/components/branding-provider";
import type { AuthShellProps } from "./types";

function Envelope({
	x,
	y,
	size,
	rotate,
	accent,
}: Readonly<{
	x: number;
	y: number;
	size: number;
	rotate: number;
	accent?: boolean;
}>) {
	const h = size * 0.68;
	return (
		<g transform={`translate(${x} ${y}) rotate(${rotate})`}>
			<rect
				x={-size / 2}
				y={-h / 2}
				width={size}
				height={h}
				rx={size * 0.08}
				fill="#ffffff"
				stroke="#16304e"
				strokeOpacity="0.18"
				strokeWidth="1.5"
			/>
			<path
				d={`M${-size / 2 + 4} ${-h / 2 + 4} L0 ${h * 0.08} L${size / 2 - 4} ${-h / 2 + 4}`}
				stroke={accent ? "#e8862a" : "#16304e"}
				strokeOpacity={accent ? 0.9 : 0.22}
				strokeWidth="1.5"
				strokeLinejoin="round"
			/>
		</g>
	);
}

/**
 * Background artwork: mail routes flowing across the page toward the sign-in card, with a few
 * envelopes in flight. Decorative only and kept to the edges so the card stays the focus.
 */
function AuthArtwork() {
	return (
		<svg
			aria-hidden="true"
			className="pointer-events-none absolute inset-0 h-full w-full"
			preserveAspectRatio="xMidYMid slice"
			viewBox="0 0 1440 900"
			fill="none"
		>
			<defs>
				<radialGradient id="auth-glow" cx="50%" cy="46%" r="42%">
					<stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
					<stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
				</radialGradient>
				<pattern id="auth-dots" width="22" height="22" patternUnits="userSpaceOnUse">
					<circle cx="2" cy="2" r="1.2" fill="#16304e" fillOpacity="0.12" />
				</pattern>
			</defs>

			<rect x="0" y="0" width="360" height="260" fill="url(#auth-dots)" />
			<rect x="1100" y="640" width="340" height="260" fill="url(#auth-dots)" />

			<g stroke="#16304e" strokeOpacity="0.12" strokeWidth="1.5">
				<path d="M-40 180 C 260 140, 360 420, 720 420" />
				<path d="M-40 720 C 240 760, 420 520, 720 470" />
				<path d="M1480 120 C 1180 160, 1080 380, 760 430" />
				<path d="M1480 780 C 1200 740, 1060 520, 760 460" />
			</g>
			<path
				d="M-40 450 C 220 450, 380 300, 700 440"
				stroke="#e8862a"
				strokeOpacity="0.55"
				strokeWidth="2"
				strokeDasharray="2 8"
				strokeLinecap="round"
			/>

			<rect x="0" y="0" width="1440" height="900" fill="url(#auth-glow)" />

			<Envelope x={210} y={250} size={72} rotate={-12} accent />
			<Envelope x={150} y={640} size={52} rotate={8} />
			<Envelope x={1240} y={220} size={60} rotate={10} />
			<Envelope x={1290} y={560} size={84} rotate={-8} accent />

			<g fill="#e8862a">
				<circle cx="360" cy="330" r="4" />
				<circle cx="1110" cy="300" r="4" />
			</g>
			<g fill="#16304e" fillOpacity="0.35">
				<circle cx="420" cy="620" r="3" />
				<circle cx="1020" cy="600" r="3" />
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
	wide = false,
}: AuthShellProps) {
	const branding = useBranding();
	const [logoFailed, setLogoFailed] = useState(false);

	return (
		<div
			data-auth-shell
			className="relative flex min-h-dvh flex-col overflow-hidden bg-[#f4f1e9] text-[#2f2a23]"
		>
			<AuthArtwork />

			<main
				id="main-content"
				tabIndex={-1}
				className="relative z-10 flex flex-1 items-center justify-center px-4 py-10 sm:px-6"
			>
				<div
					className={cn(
						"w-full rounded-3xl border border-[#e7e0d2] bg-white/95 px-6 py-8 shadow-[0_24px_60px_-28px_rgb(22_48_78/0.35)] backdrop-blur-sm sm:px-10 sm:py-10",
						wide ? "max-w-xl" : "max-w-[26rem]",
					)}
				>
					<div className="flex justify-center">
						{logoFailed ? (
							<Icon className="size-9 text-[#16304e]" aria-label={branding.appName} />
						) : (
							<Image
								src="/ccmail_logo_full.png"
								onError={() => setLogoFailed(true)}
								alt={branding.appName}
								width={160}
								height={36}
								className="h-9 w-auto max-w-40 object-contain"
							/>
						)}
					</div>

					{steps && (
						<ol className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 font-mono text-[0.6875rem] tracking-[0.14em] uppercase">
							{steps.map((step, index) => (
								<li key={step.label} className="flex items-center gap-3">
									<span className={step.active ? "text-[#c96a15]" : "text-[#8a7f6e]"}>
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

					<div className="mt-6 text-center">
						<h1 className="text-2xl leading-tight font-semibold tracking-[-0.02em] text-[#16304e]">
							{title}
						</h1>
						{description && (
							<p className="mx-auto mt-2 max-w-[22rem] text-sm leading-6 text-[#6c6353]">
								{description}
							</p>
						)}
					</div>

					<div className="mt-8 w-full">{children}</div>

					{footer && (
						<div className="mt-8 border-t border-[#ece6da] pt-5 text-center text-sm text-[#6c6353]">
							{footer}
						</div>
					)}
				</div>
			</main>
		</div>
	);
}
