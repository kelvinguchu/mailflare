"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { BrandingContextValue } from "./branding-provider-types";
import { DEFAULT_BRANDING, fetchBranding } from "./branding-provider-utils";

const BrandingContext = createContext<BrandingContextValue | null>(null);

export function BrandingProvider({ children }: { children: React.ReactNode }) {
	const [branding, setBranding] = useState(DEFAULT_BRANDING);
	const [iconVersion, setIconVersion] = useState(0);
	const currentAppName = useRef(DEFAULT_BRANDING.appName);

	const refreshBranding = useCallback(async () => {
		const nextBranding = await fetchBranding();
		setBranding(nextBranding);
		setIconVersion(Date.now());
		if (document.title === "CC Mail" || document.title === currentAppName.current) {
			document.title = nextBranding.appName;
		}
		currentAppName.current = nextBranding.appName;
	}, []);

	useEffect(() => {
		void refreshBranding();
	}, [refreshBranding]);

	return (
		<BrandingContext.Provider
			value={{
				...branding,
				iconUrl: branding.hasCustomIcon
					? `/api/branding/icon?v=${iconVersion}`
					: "/cc-mail-logo.png",
				refreshBranding,
			}}
		>
			{children}
		</BrandingContext.Provider>
	);
}

export function useBranding() {
	return (
		useContext(BrandingContext) ?? {
			...DEFAULT_BRANDING,
			iconUrl: "/cc-mail-logo.png",
			refreshBranding: async () => undefined,
		}
	);
}
