# Operational visibility

The administrator Operations page is the application-level view of CC Mail processing and recovery health. It reports aggregate metadata only. It never returns message bodies, subjects, addresses, queue payloads, webhook secrets, credentials, or backup contents.

## Health sources

- **Queues:** live backlog count, backlog bytes, and oldest-message time from the inbound, outbound, and webhook Queue bindings.
- **Delivery:** accepted, delivered, failed, suppressed, and unknown outbound outcomes from D1 for the last 24 hours, plus pending and retrying outbound jobs.
- **Async work:** unresolved dead letters, webhook retries/failures, and reminder retries/failures from their durable D1 records.
- **D1:** `D1Result.meta.size_after` from a bounded health query.
- **R2:** object count and bytes from metadata-only paginated listing. A scan stops before the Worker subrequest ceiling and is explicitly marked incomplete if that safety limit is reached.
- **Recovery:** latest successful and failed backups plus the latest restore drill that verified D1, R2, rollback, session invalidation, and cleanup.

## Collection

Queue and delivery health is read live when an administrator opens or refreshes `/operations`. Storage measurements are intentionally less frequent because a complete R2 metadata scan can require several binding calls:

- production records a storage snapshot during the daily 02:00 UTC maintenance run;
- an administrator can request a fresh measurement from the Operations page;
- snapshots older than 400 days are removed after a new snapshot is stored.

The staging restore drill records a successful drill only after every assertion and cleanup check passes. Failed or partial runs do not become verified evidence.

## Alert thresholds

Administrators can configure backlog count, oldest queue message age, delivery failures, unknown outcomes, webhook failures, reminder failures, unresolved dead letters, backup age, and D1/R2 growth. Threshold changes require recent authentication and are written to the audit log.

A backup age of `0` uses schedule-aware defaults: 36 hours for daily, 192 hours for weekly, 840 hours for monthly, and 168 hours when automatic backup is disabled.

## R2 scan safety

The scanner reads no object bodies or custom metadata. It lists at most 900 pages of 1,000 objects per invocation. If more objects remain, the displayed object count and byte total are lower bounds and the dashboard raises `R2_SCAN_INCOMPLETE`.
