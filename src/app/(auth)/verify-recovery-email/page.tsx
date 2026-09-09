import { VerifyRecoveryEmailClient } from "./verify-recovery-email-client";

export const dynamic = "force-dynamic";

export default async function VerifyRecoveryEmailPage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string }>;
}) {
	const { token = "" } = await searchParams;
	return <VerifyRecoveryEmailClient token={token} />;
}
