"use client";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import * as React from "react";
import { cn } from "@/lib/utils";

export const Dialog = BaseDialog.Root;
export const DialogClose = BaseDialog.Close;

/**
 * Base UI composes via a `render` prop; the app's call sites use Radix's
 * `asChild`, so translate it here rather than at every call site.
 */
export function DialogTrigger({
	asChild,
	children,
	...props
}: React.ComponentProps<typeof BaseDialog.Trigger> & { asChild?: boolean }) {
	const child = asChild && React.isValidElement(children) ? children : undefined;
	return (
		<BaseDialog.Trigger render={child} {...props}>
			{child ? undefined : children}
		</BaseDialog.Trigger>
	);
}

export function DialogContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof BaseDialog.Popup>) {
	return (
		<BaseDialog.Portal>
			<BaseDialog.Backdrop className="dialog-overlay fixed inset-0 z-50 bg-black/35" />
			<BaseDialog.Popup
				className={cn(
					"dialog-content fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(520px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl outline-none",
					className,
				)}
				{...props}
			>
				{/* The popup itself never scrolls, so the close button stays anchored
				    to its top-right corner while only the body scrolls. */}
				<div className="dialog-scroll flex min-h-0 flex-1 flex-col p-6">{children}</div>
				<BaseDialog.Close className="absolute right-4 top-4 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300">
					<X className="h-4 w-4" />
					<span className="sr-only">Close</span>
				</BaseDialog.Close>
			</BaseDialog.Popup>
		</BaseDialog.Portal>
	);
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
	return <div className={cn("mb-5 space-y-1.5 pr-8", className)} {...props} />;
}

export function DialogTitle({
	className,
	...props
}: React.ComponentProps<typeof BaseDialog.Title>) {
	return <BaseDialog.Title className={cn("text-lg font-semibold text-neutral-900", className)} {...props} />;
}

export function DialogDescription({
	className,
	...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
	return <BaseDialog.Description className={cn("text-sm text-neutral-500", className)} {...props} />;
}
