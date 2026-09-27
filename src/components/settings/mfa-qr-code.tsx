"use client";

import { useMemo } from "react";
import { getQrMatrix } from "./mfa-utils";

/**
 * Renders the authenticator QR code as inline SVG generated in the browser. When encoding fails
 * the manual key beside it remains the enrollment path.
 */
export function MfaQrCode({ otpauthUri }: Readonly<{ otpauthUri: string }>) {
	const path = useMemo(() => {
		try {
			const matrix = getQrMatrix(otpauthUri);
			const segments: string[] = [];
			matrix.forEach((row, y) =>
				row.forEach((dark, x) => {
					if (dark) segments.push(`M${x} ${y}h1v1h-1z`);
				}),
			);
			return { size: matrix.length, d: segments.join("") };
		} catch {
			return null;
		}
	}, [otpauthUri]);

	if (!path) {
		return (
			<p role="status" className="rounded-xl bg-neutral-100 p-4 text-sm text-neutral-600">
				The QR code couldn’t be displayed. Use the setup key instead.
			</p>
		);
	}

	const quietZone = 3;
	const viewBox = `${-quietZone} ${-quietZone} ${path.size + quietZone * 2} ${path.size + quietZone * 2}`;
	return (
		<svg
			role="img"
			aria-label="QR code to add CC Mail to your authenticator app"
			viewBox={viewBox}
			shapeRendering="crispEdges"
			className="size-44 rounded-xl bg-white ring-1 ring-neutral-200"
			data-qr-size={path.size}
		>
			<rect x={-quietZone} y={-quietZone} width="100%" height="100%" fill="#ffffff" />
			<path d={path.d} fill="#111827" />
		</svg>
	);
}
