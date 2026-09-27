# Calendar, tasks, and reminders backend

## Time model

- Timed values are persisted as UTC instants and requests must include `Z` or a numeric UTC offset.
- Every event, task, and reminder also stores an IANA timezone such as `Africa/Nairobi` so the user's wall-clock intent can be rendered correctly.
- All-day events use an exclusive end date. All-day task dates and event boundaries use `YYYY-MM-DD` values and are stored at UTC midnight together with `allDay: true`.

## Recurrence policy

Recurrence is deliberately not enabled in this release. The APIs reject a non-empty `recurrenceRule` instead of accepting a rule they cannot apply safely.

Before recurrence is enabled, the schema must add a stable series identity, occurrence identity, excluded occurrence dates, and per-occurrence overrides. Editing and deleting must explicitly distinguish one occurrence from the complete series. Reminders must target concrete occurrences, and timezone or daylight-saving changes must regenerate only future occurrences without changing past delivery history.

Until that model exists, each event and task is a single concrete item.

## APIs

### Events

- `GET /api/calendar/events?start=&end=` lists overlapping events owned by the authenticated user.
- `POST /api/calendar/events` creates an event. Timed requests use offset-aware instants; all-day requests use date-only boundaries.
- `GET /api/calendar/events/:eventId` returns one owned event.
- `PATCH /api/calendar/events/:eventId` updates an event and increments its iCalendar sequence.
- `DELETE /api/calendar/events/:eventId` cancels an event and queues cancellation notices when it has an authorized organizer and attendees.

Event invitation requests use account-scoped idempotency keys. Invitations, updates, and cancellations retain the event ID as their stable iCalendar UID.

### Tasks

- `GET /api/calendar/tasks?scope=assigned|created|all&status=open|completed|all&overdue=true&start=&end=` lists tasks assigned to the current account, created by it, or either.
- `POST /api/calendar/tasks` creates a task.
- `GET /api/calendar/assignees` lists active, enabled CC Mail accounts available for assignment.
- `GET`, `PATCH`, and `DELETE /api/calendar/tasks/:taskId` read, update, and delete an accessible task. The creator controls reassignment and deletion; the creator and assignee can edit or complete it.
- `GET /api/calendar/tasks/:taskId/activity` returns its creator/assignee-scoped activity history.
- `POST /api/calendar/tasks/:taskId/complete` completes a task and atomically cancels all scheduled or claimed reminders attached to it.
- `DELETE /api/calendar/tasks/:taskId/complete` reopens a task. Cancelled reminders stay cancelled and must be explicitly recreated.

Every task retains separate creator, assignee, assignment time, completer, and completion time fields. Assignment targets must be active, enabled accounts. Assignment, edits, reassignment, completion, reopening, and deletion are recorded in the existing audit log rather than a separate task-event table.

### Reminders

- `GET /api/calendar/reminders` supports status, due, event, task, and date-range filters.
- `POST /api/calendar/reminders` creates an in-app or email reminder for exactly one owned event or task.
- `PATCH /api/calendar/reminders/:reminderId` updates and reschedules a reminder.
- `DELETE /api/calendar/reminders/:reminderId` cancels a reminder without erasing its delivery history.
- `POST /api/calendar/reminders/:reminderId/dismiss` dismisses it.
- `POST /api/calendar/reminders/:reminderId/snooze` reschedules it to an offset-aware `until` instant.
- `GET /api/calendar/reminders/:reminderId/deliveries` returns owner-scoped delivery history.

## Delivery guarantees

Production invokes the reminder dispatcher every minute through a UTC Cron Trigger. Each scheduler run atomically claims due records. Abandoned claims become eligible again after five minutes.

Task reminders have two completion guards: the due query excludes completed tasks, and the atomic claim plus pre-delivery check rejects reminders cancelled or completed while dispatch was starting. Completing a task cancels both scheduled and processing reminders. Reopening never revives them, preventing an old alert from firing unexpectedly.

Every emission has a stable key derived from the reminder ID and its effective scheduled instant. The same key is used for the delivery-history uniqueness constraint and outbound email idempotency. A repeated or overlapping scheduler execution therefore cannot create a second logical delivery. Failed reminders retry up to five times and retain a safe error plus attempt history.

An in-app reminder is considered delivered when its due record is persisted. An email reminder is considered emitted when its outbound email job is durably queued; final provider state remains available through the associated outbound job and message IDs.

Staging has no automatic cron by design. Its scheduled handler can be invoked explicitly for isolated verification.

## Authorization and retention

All APIs require an active authenticated account. Events remain owner-scoped; tasks are visible only to their creator and current assignee. Referenced events, tasks, and mailboxes must be accessible to the acting account. Each participant owns the reminders they create on a shared task. Email reminders additionally require send-on-behalf permission and a permitted sender address.

Tasks, reminders, and delivery history are application backup tables. They are included in backup format version 7 and are restored in foreign-key order. Deleting a task or event cascades to its reminders. Account archival requires an active successor when calendar data or open assignments exist, transfers owned records and open assignments to that successor, and only then permits the separate permanent-deletion step.

## CaliberCode integration

CaliberCode's CMS mirrors paid advisory bookings and published, scheduled event dates through a private `CalendarSyncService` Worker entrypoint. The source IDs are `cc_advisory_<id>` and `cc_event_<id>`; these appear in the ordinary calendar UI but are read-only there. Changes and cancellations must originate in Payload. Entries belong to the active Mailflare user `mohamed@calibercode.io`; if that account does not exist, the CMS retries on its next five-minute cron. Native in-app reminders are scheduled 24 hours before start. Separate email reminders are queued in the CMS for Mohamed (advisory) and `contact@calibercode.io` (events).

## Platform references

- [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Workers scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [D1 database API and transactional batches](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare Queues batching, retries, and delays](https://developers.cloudflare.com/queues/configuration/batching-retries/)
