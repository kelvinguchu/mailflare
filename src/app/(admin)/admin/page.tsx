import Link from "next/link";
import {
	Activity,
	AlertTriangle,
	ChevronRight,
	DatabaseBackup,
	Gauge,
	Globe2,
	KeyRound,
	Mail,
	Palette,
	ShieldBan,
	ShieldCheck,
	Users,
	Webhook,
	type LucideIcon,
} from "lucide-react";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

type Section = { href: string; title: string; description: string; icon: LucideIcon };

const groups: Array<{ label: string; sections: Section[] }> = [
	{
		label: "Email",
		sections: [
			{
				href: "/mailboxes",
				title: "Mailboxes",
				description: "Create addresses and manage who can use them.",
				icon: Mail,
			},
			{
				href: "/domains",
				title: "Domains",
				description: "Add Cloudflare domains and check their DNS.",
				icon: Globe2,
			},
			{
				href: "/sender-policies",
				title: "Sender policies",
				description: "Allow or block senders before mail is delivered.",
				icon: ShieldBan,
			},
			{
				href: "/delivery-failures",
				title: "Delivery failures",
				description: "Inspect and replay mail that ran out of retries.",
				icon: AlertTriangle,
			},
		],
	},
	{
		label: "Administration",
		sections: [
			{
				href: "/operations",
				title: "Operations",
				description: "Queues, delivery, storage, and recovery health.",
				icon: Gauge,
			},
			{
				href: "/security",
				title: "Security",
				description: "MFA coverage and enrollment windows.",
				icon: ShieldCheck,
			},
			{
				href: "/accounts",
				title: "Accounts",
				description: "Invite people and manage their access.",
				icon: Users,
			},
			{
				href: "/activity",
				title: "Activity",
				description: "Sign-ins and sign-outs across accounts.",
				icon: Activity,
			},
			{
				href: "/backups",
				title: "Backups",
				description: "Export and restore the database.",
				icon: DatabaseBackup,
			},
		],
	},
	{
		label: "Product",
		sections: [
			{
				href: "/branding",
				title: "Branding",
				description: "App name, icon, and favicon.",
				icon: Palette,
			},
			{
				href: "/api-keys",
				title: "API keys",
				description: "Credentials for programmatic access.",
				icon: KeyRound,
			},
			{
				href: "/webhooks",
				title: "Webhooks",
				description: "Send mail events to other systems.",
				icon: Webhook,
			},
		],
	},
];

export default function AdminOverviewPage() {
	return (
		<div className="space-y-8 pt-2">
			<AdminPageHeader title="Admin" />
			{groups.map((group) => (
				<section key={group.label} aria-labelledby={`admin-group-${group.label}`}>
					<h2
						id={`admin-group-${group.label}`}
						className="mb-3 px-1 text-xs font-semibold tracking-wider text-neutral-500 uppercase"
					>
						{group.label}
					</h2>
					<ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
						{group.sections.map((section) => {
							const Icon = section.icon;
							return (
								<li key={section.href}>
									<Link
										href={section.href}
										className="group flex h-full items-center gap-4 rounded-2xl bg-white p-4 ring-1 ring-neutral-200/70 transition-colors hover:bg-primary/5 hover:ring-primary/20 focus-visible:ring-2 focus-visible:ring-primary/40"
									>
										<span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
											<Icon className="size-5" aria-hidden="true" />
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-sm font-medium text-neutral-900">
												{section.title}
											</span>
											<span className="mt-0.5 block text-xs text-neutral-500">
												{section.description}
											</span>
										</span>
										<ChevronRight
											aria-hidden="true"
											className="size-4 shrink-0 text-neutral-300 transition-colors group-hover:text-primary"
										/>
									</Link>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}
