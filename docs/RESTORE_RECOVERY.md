# CC Mail restore recovery

Database restoration is an administrator-only operation. Do not run a restore drill against production; use the separate staging environment once Phase 0.2 of `PRODUCTION_READINESS.md` is complete.

## What the restore endpoint does

1. Rejects files larger than 10 MiB.
2. Parses and validates the backup format, version, tables, columns and scalar value types.
3. Confirms that every referenced raw message, attachment, avatar and branding object has a matching independent R2 snapshot with the recorded size, ETag and available checksums.
4. Creates a complete pre-restore recovery bundle containing the current D1 data and independent copies of its referenced R2 objects, then records it in Backup history.
5. Loads the uploaded rows into isolated staging tables.
6. Copies the selected backup's R2 snapshots back to their original live keys and verifies their size and available checksum.
7. Deletes and replaces the live application rows in one D1 `batch()` transaction. Cloudflare D1 rolls back the whole batch if any statement fails.
8. If an object copy or the D1 transaction fails, restores affected live object keys from the pre-restore recovery bundle.
9. Does not restore session rows. Every user, including the administrator who ran the restore, must sign in again.
10. Removes the staging tables.

## If restoration reports an error

- The live replacement transaction either commits completely or rolls back completely. Do not retry repeatedly until the error has been understood.
- Check Backup history for the `pre-restore` recovery bundle. It is created before staging begins, so it exists even when staging, R2 copying or the final transaction fails.
- Review Worker logs for `database_restore_object_rollback_failed`. If present, do not retry: retain the named recovery bundle and manually assess the affected live R2 keys first.
- Review Worker logs for `database_restore_staging_cleanup_failed`. That event means live data is still protected, but temporary staging tables require inspection and cleanup before another restore.
- If the failure says an R2 object is missing, restore or deliberately replace that object before retrying. Do not bypass the object check.

## If a completed restore has the wrong data

1. Sign in again with an administrator account from the restored data.
2. Open **Admin settings → Backups**.
3. Locate the most recent `cc-mail-v3-pre-restore-*.json` entry.
4. Download and retain a local copy before taking further action.
5. Restore that recovery file. CC Mail will create another pre-restore recovery file first, preserving the ability to undo the rollback.
6. Verify account access, mailbox counts, recent messages, attachments, avatars and sending configuration.

## Emergency D1 Time Travel path

Cloudflare D1 Time Travel is an independent last-resort recovery path. It is always enabled on production D1 databases and can restore to a recent timestamp or bookmark.

```powershell
npx wrangler d1 time-travel info DB
npx wrangler d1 time-travel restore DB --bookmark=<bookmark-from-info>
```

Time Travel overwrites the database in place. Record the current bookmark and the previous bookmark returned by the restore command so the operation can itself be undone. Use this path only after the application recovery backup path has been assessed.
