import packageJson from "../../package.json";
import { useSidebar } from "./sidebar-state";

export function SidebarFooter() {
	const { minimal } = useSidebar();
	if (minimal) return null;
	return (
		<p className="px-3 pt-3 text-xs text-neutral-400">
			CC Mail v{packageJson.version}
		</p>
	);
}
