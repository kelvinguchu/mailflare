# Undo Send

CC Mail implements Undo Send as delayed delivery, not message recall. The browser composer lets the user choose 5, 10, 20, or 30 seconds; 10 seconds is the default. API-key sends and internal system messages remain immediate unless their caller explicitly requests a delay.

## Request and response

The authenticated browser send route accepts `X-Undo-Send-Delay-Seconds`. Unsupported or missing values use the 10-second default. A successful delayed send returns HTTP 202 with:

```json
{
	"jobId": "job_...",
	"messageId": "msg_...",
	"status": "scheduled",
	"idempotencyKey": "...",
	"undoDeadline": "2026-09-14T08:00:10.000Z"
}
```

The composer closes as soon as the user presses Send and keeps an in-memory snapshot of the message and attachments. A single toast tracks the send: "Sending…" while the request is in flight, then "Message sent" with an Undo action that stays until `undoDeadline`. The toast's lifetime comes from that server deadline; the client never manufactures one. A successful Undo reopens the composer with the snapshot and a fresh Idempotency-Key, because the canceled job still owns the original key. A failed send offers to reopen the message, and a send whose response never arrived offers Retry with the same key.

`POST /api/send/{jobId}/cancel` requires an authenticated session and is owner-scoped:

- `200`: the job is canceled (including an idempotent repeat cancellation).
- `404`: the job does not exist for the authenticated user.
- `409`: the deadline passed or delivery already claimed the job. The UI must not imply recall.

## Durable state and race behavior

Delayed sends persist `status = scheduled` and `send_not_before` in D1 before a Cloudflare Queue message is produced with the same delay. The consumer also checks the D1 deadline, so early or duplicate queue delivery cannot bypass the Undo window.

The cancellation endpoint may transition only:

```text
scheduled + before deadline + unclaimed -> canceled
```

The consumer may claim only:

```text
queued -> sending
scheduled + deadline reached -> sending
```

Both are conditional D1 updates. A successful cancellation makes the provider claim impossible; a successful provider claim makes cancellation return 409. Duplicate queue deliveries and idempotent send retries converge on the same job, and the consumer drops canceled jobs without calling Cloudflare Email Service.

## Operations

Migration `0038_add_undo_send.sql` adds `send_not_before`, `canceled_at`, and the due-job index. Apply migrations before deploying code that writes scheduled jobs.

The implementation follows Cloudflare's per-message Queue delay API and D1 prepared/batch APIs:

- <https://developers.cloudflare.com/queues/configuration/batching-retries/>
- <https://developers.cloudflare.com/queues/configuration/javascript-apis/>
- <https://developers.cloudflare.com/d1/worker-api/d1-database/>
