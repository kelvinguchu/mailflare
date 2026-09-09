# Staging restore drill

## Purpose

This drill proves that a CC Mail backup can restore D1 application state and independently copied R2 objects without risking production. It also exercises the failure path after object mutation but before the final D1 commit.

The runner is `scripts/staging-restore-drill.mjs` and the command is `npm run drill:restore:staging`. It is intentionally restricted to the empty, isolated `mailflare-staging` environment documented in [deployment.md](deployment.md).

## Verified behavior

The runner performs these checks through the deployed staging Worker and remote staging bindings:

1. Refuse to proceed unless the target is the isolated staging environment, the explicit confirmation is present, setup has no administrator, and application tables are empty.
2. Create run-scoped D1 fixtures and six R2 sources: user avatar, mailbox avatar, branding icon, raw RFC 822 message, inline image and downloadable attachment.
3. Start the deployed `mailflare-database-backup-staging` Workflow, wait for completion, download the version 4 manifest, and verify its D1 and R2 coverage.
4. Mutate the live fixture, then submit a structurally valid backup containing a duplicate unique email. The restore copies snapshot objects first and fails in the final atomic D1 batch.
5. Verify that D1 remains at the pre-attempt mutated state, every mutated R2 source is rolled back from the automatic recovery bundle, and the active session remains valid.
6. Restore the original valid backup and verify the original D1 values and all six R2 byte sequences, global session invalidation, the retained pre-restore recovery bundle, and zero temporary `_cc_restore_*` tables.
7. Delete only the run-scoped D1 fixtures, source objects, manifests and snapshot objects, then restore the migration-seeded application settings row.

## 2026-09-09 result

| Evidence | Value |
| --- | --- |
| Result | Passed |
| Staging Worker | `mailflare-staging` |
| Worker version | `74bd948c-6ee7-42d0-8c50-97b7ec00da58` |
| Run | `drill_20260909065804_7808a312` |
| Source backup | `bak_0xm-BlgBecFj9gbQOsEWa` |
| Injected failure | Final D1 batch rejected duplicate `users.email` with `SQLITE_CONSTRAINT_UNIQUE` |
| Failure recovery bundle | `bak_restore_ac5b4f2a70744678876257bb7662b2d4` |
| Successful-restore recovery bundle | `bak_restore_4b1b21b9e45741c389034c723af87d43` |
| R2 sources restored | 6 of 6, byte-for-byte |
| Sessions after successful restore | 0 |
| Temporary restore tables after successful restore | 0 |

Post-drill verification found zero staging users, domains, mailboxes, messages, attachments, sessions, backups and temporary restore tables. The migration-seeded `app_settings` row matched its pre-drill values, and a direct lookup of the run's raw-message fixture returned “key does not exist.” Production was not targeted by the runner.
