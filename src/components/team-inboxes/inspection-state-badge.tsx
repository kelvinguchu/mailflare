import { cn } from "cn";

const states = {
	deleted: { label: "Deleted", color: "bg-red-100 text-red-800" },
	trash: { label: "Trash", color: "bg-amber-100 text-amber-800" },
	draft: { label: "Draft", color: "bg-blue-100 text-blue-800" },
	history: { label: "Deletion history", color: "bg-violet-100 text-violet-800" },
};

export function InspectionStateBadge({
	state,
	className,
}: {
	state: keyof typeof states;
	className?: string;
}) {
	return (
		<span
			data-inspection-state={state}
			className={cn(
				"inline-flex rounded px-1.5 py-0.5 align-middle text-[11px] font-medium",
				states[state].color,
				className,
			)}
		>
			{states[state].label}
		</span>
	);
}
