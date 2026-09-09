import { ActivateAccountClient } from "./activate-account-client";

export const dynamic = "force-dynamic";

export default async function ActivateAccountPage({
	searchParams,
}: {
	searchParams: Promise<{ token?: string }>;
}) {
	const { token = "" } = await searchParams;
	return <ActivateAccountClient token={token} />;
}
