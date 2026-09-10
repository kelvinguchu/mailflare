"use client";

import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = BaseSelect.Root;
export const SelectGroup = BaseSelect.Group;
export const SelectGroupLabel = BaseSelect.GroupLabel;

export function SelectTrigger({
	className,
	children,
	...props
}: React.ComponentProps<typeof BaseSelect.Trigger>) {
	return (
		<BaseSelect.Trigger
			className={cn(
				"flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-3 text-left text-sm text-neutral-900 transition-colors hover:bg-neutral-50 focus-visible:border-blue-600 focus-visible:outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50",
				className,
			)}
			{...props}
		>
			{children}
			<BaseSelect.Icon className="flex shrink-0 text-neutral-400">
				<ChevronDown className="h-4 w-4" />
			</BaseSelect.Icon>
		</BaseSelect.Trigger>
	);
}

export function SelectValue({
	className,
	...props
}: React.ComponentProps<typeof BaseSelect.Value>) {
	return <BaseSelect.Value className={cn("truncate", className)} {...props} />;
}

export function SelectContent({
	className,
	children,
	...props
}: React.ComponentProps<typeof BaseSelect.Popup>) {
	return (
		<BaseSelect.Portal>
			<BaseSelect.Positioner sideOffset={6} className="z-[60]" alignItemWithTrigger={false}>
				<BaseSelect.Popup
					className={cn(
						"max-h-[min(20rem,var(--available-height))] min-w-[var(--anchor-width)] overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 shadow-lg outline-none",
						className,
					)}
					{...props}
				>
					{children}
				</BaseSelect.Popup>
			</BaseSelect.Positioner>
		</BaseSelect.Portal>
	);
}

export function SelectItem({
	className,
	children,
	...props
}: React.ComponentProps<typeof BaseSelect.Item>) {
	return (
		<BaseSelect.Item
			className={cn(
				"flex cursor-default select-none items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-neutral-700 outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-neutral-100 data-[highlighted]:text-neutral-900 data-[selected]:font-medium data-[selected]:text-neutral-900",
				className,
			)}
			{...props}
		>
			<BaseSelect.ItemText className="truncate">{children}</BaseSelect.ItemText>
			<BaseSelect.ItemIndicator className="flex shrink-0 text-blue-600">
				<Check className="h-4 w-4" />
			</BaseSelect.ItemIndicator>
		</BaseSelect.Item>
	);
}
