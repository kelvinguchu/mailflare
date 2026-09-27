import { MfaPolicyManager } from "@/components/admin/mfa-policy-manager";
import { AdminPageHeader } from "@/components/admin/admin-page-header";

export default function SecurityPage() {
	return (
		<div className="space-y-8">
			<AdminPageHeader title="Security" />
			<MfaPolicyManager />
		</div>
	);
}
