import * as React from "react";
import { cn } from "@/lib/utils";
import type { SelectProps } from "./select-types";

/**
 * Native <select>. Retained for form rows that have not been moved to the
 * Base UI `Select` yet.
 */
export const NativeSelect = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, ...props }, ref) => (
    <select
      className={cn(
        "h-10 w-auto max-w-full rounded-lg border border-neutral-200 bg-white px-2 text-sm focus-visible:border-blue-600 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    />
  ),
);
NativeSelect.displayName = "NativeSelect";
