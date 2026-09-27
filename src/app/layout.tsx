import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";
import { APP_ROBOTS_METADATA } from "@/lib/security/indexing";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "CC Mail",
	description: "CC Mail — business email powered by Cloudflare",
	icons: { icon: "/favicon.ico" },
	robots: APP_ROBOTS_METADATA,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
	return (
		<html lang="en" className={cn("font-sans", inter.variable)}>
			<head>
				<link rel="icon" href="/favicon.ico" type="image/x-icon"></link>
			</head>
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased light`}>
				<a
					className="skip-link fixed -top-20 left-3 z-[200] max-w-[calc(100vw-1.5rem)] rounded-lg bg-primary px-3.5 py-2.5 font-semibold text-primary-foreground transition-[top] focus-visible:top-3 focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 motion-reduce:transition-none"
					href="#main-content"
				>
					Skip to main content
				</a>
				<Providers>{children}</Providers>
			</body>
		</html>
	);
}
