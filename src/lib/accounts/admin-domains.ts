import { asc, eq } from "drizzle-orm";
import type { getDb } from "@/db";
import { domains, mailboxes, users } from "@/db/schema";
import { assertAdmin } from "@/lib/auth/admin";
import type { SessionUser } from "@/lib/auth/types";

type Db = ReturnType<typeof getDb>;

export function requireActiveAdmin(user: SessionUser) {
	assertAdmin(user);
	if (user.disabled || user.activationStatus !== "active" || user.archivedAt) {
		throw new Error("Forbidden");
	}
}

/** Account provisioning is installation-wide; domain ownership is unchanged. */
export function listAccountDomains(db: Db, user: SessionUser) {
	requireActiveAdmin(user);
	return db.select().from(domains).orderBy(asc(domains.hostname));
}

export async function getAccountDomain(db: Db, user: SessionUser, domainId: string) {
	requireActiveAdmin(user);
	const [domain] = await db.select().from(domains).where(eq(domains.id, domainId)).limit(1);
	return domain ?? null;
}

/** Reserve the user and mailbox together; database uniqueness settles competing requests. */
export async function reserveAccountAddress(
	db: Db,
	creator: SessionUser,
	account: typeof users.$inferInsert,
	mailbox: typeof mailboxes.$inferInsert,
) {
	requireActiveAdmin(creator);
	if (!(await getAccountDomain(db, creator, mailbox.domainId))) throw new Error("Domain not found");
	return db.batch([
		db.insert(users).values({ ...account, createdByUserId: creator.id }),
		db.insert(mailboxes).values({ ...mailbox, userId: account.id }),
	]);
}
