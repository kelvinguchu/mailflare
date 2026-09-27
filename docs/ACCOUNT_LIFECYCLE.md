# Account lifecycle backend contract

Implemented and deployed on 2026-09-15 with migration `0045_add_account_archival.sql`.

All lifecycle endpoints require an administrator session and recent authentication. They return
JSON errors as `{ "error": "..." }`. Destructive actions require an exact, case-sensitive typed
confirmation so an accidental click or replayed generic request cannot perform them.

## Reset and re-invite an active account

`POST /api/accounts/:accountId/reset`

```json
{
	"invitationEmail": "person@example.com",
	"confirmation": "reset person@company.example"
}
```

The operation revokes every session and recovery token, replaces the password with an unusable
random value, clears MFA enrollment and recovery codes, and changes the account to `pending`. The
response reports `invitationDelivery` as `pending` or `delivery_disabled`. The administrator cannot
reset their own account or remove the last active administrator.

## Transfer one mailbox

`POST /api/mailboxes/:mailboxId/ownership`

```json
{
	"newOwnerUserId": "usr_successor",
	"confirmation": "transfer support@company.example"
}
```

The target must be active. The mailbox, its folders, messages, signature assets, and related
outbound-job ownership move atomically. The previous owner receives `full_access`, so the transfer
does not unexpectedly remove access. An audit record preserves both owner IDs and the address.

## Archive an account

`POST /api/accounts/:accountId/lifecycle`

```json
{
	"action": "archive",
	"successorUserId": "usr_successor",
	"confirmation": "archive person@company.example"
}
```

A successor is mandatory whenever the account owns domains, mailboxes, retained messages, events,
tasks, open assignments, or reminders. The transition cancels sends that have not started, revokes
sessions, recovery tokens, API keys, webhooks, sender policies, and delegated mailbox access, then
reassigns business records atomically. The account becomes disabled, revoked, and timestamped as
archived. Self-archival and removal of the last active administrator are rejected.

## Permanently delete an archived account

Use the same endpoint:

```json
{
	"action": "delete",
	"confirmation": "delete person@company.example"
}
```

Deletion is a separate second step. It is rejected unless the account is already archived and no
business records or open assignments remain. Personal records then follow their declared foreign-key
retention policy. The deletion audit intentionally stores the deleted ID and address in metadata, so
the record remains meaningful after its foreign key is cleared.

## Export an account package

`GET /api/accounts/:accountId/export`

This streams an `application/x-tar` download. It contains JSON files for account-owned D1 records,
an R2 object index, and the referenced avatar, raw-message, attachment, and signature image objects.
Password hashes, MFA secrets, API-key hashes, webhook secrets, session token hashes, and recovery
token hashes are intentionally excluded. Export before archive if the package must contain business
records that will be transferred to the successor.

## Existing account update safeguard

Disabling an account or demoting an administrator through `PATCH /api/accounts/:accountId` now also
requires `"confirmation": "update person@company.example"`. Archived accounts cannot be edited or
invited through the ordinary account endpoints.
