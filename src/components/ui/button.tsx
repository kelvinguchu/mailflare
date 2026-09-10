import * as React from "react";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
	{
		variants: {
			variant: {
				default: "bg-blue-600 text-white hover:bg-blue-700",
				outline: "border border-neutral-200 bg-white hover:bg-neutral-100",
				ghost: "hover:bg-neutral-100",
				destructive: "bg-red-600 text-white hover:bg-red-700",
			},
			size: {
				default: "h-10 px-6 py-2 rounded-xl",
				sm: "h-8 rounded-lg px-3 text-xs",
				lg: "h-11 rounded-xl px-8",
				icon: "h-10 w-10 rounded-xl p-0",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

export interface ButtonProps
	extends React.ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {
	/** Render the single child element instead of a <button>, merging props onto it. */
	asChild?: boolean;
	ref?: React.Ref<HTMLButtonElement>;
}

export function Button({ className, variant, size, asChild = false, children, ref, ...props }: ButtonProps) {
	const child = asChild && React.isValidElement(children) ? children : undefined;

	return useRender({
		defaultTagName: "button",
		render: child,
		ref,
		props: {
			className: cn(buttonVariants({ variant, size, className })),
			...(child ? {} : { children }),
			...props,
		},
	});
}

export { buttonVariants };
