"use client";

import { ComposeForm } from "@/components/compose/compose-form";

export default function ComposePage() {
	return (
		<div className="h-full overflow-auto p-4 sm:p-8">
			<div className="mb-4 sm:mb-6">
				<h1 className="text-2xl font-normal text-neutral-900">Compose</h1>
				<p className="mt-1 text-sm text-neutral-500">
					Write a new email. Drafts save automatically.
				</p>
			</div>
			<ComposeForm mode="page" />
		</div>
	);
}
