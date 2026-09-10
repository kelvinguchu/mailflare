# Deliverability and abuse operations

## What “sent” means

CC Mail records `queued` while a message waits for the outbound Queue and
`accepted` after Cloudflare Email Service returns a provider message ID. The
Workers binding currently reports provider acceptance, not final mailbox
delivery. Provider rejections are stored with their safe error code and retry
count. A hard suppression response (`E_RECIPIENT_SUPPRESSED`) blocks that
recipient for future sends.

## Domain readiness

The Domains page checks Email Routing and Email Sending independently and also
looks for SPF, DKIM, and DMARC records. Treat a changed or missing record as a
deployment incident: pause sending for the domain, compare the displayed
records with Cloudflare’s current required records, repair DNS, and verify the
page again before resuming.

Start DMARC with monitoring (`p=none`) and aggregate reports, then move to
quarantine/reject only after all legitimate senders align. Keep SPF to one
record and under the DNS lookup limit. Rotate DKIM only through the provider’s
documented overlap process.

## Warm-up and reputation

- Start new domains with small, consistent volumes to recipients who expect
  the mail. Increase gradually only while complaints and hard failures remain
  low.
- Never import purchased lists. Remove invalid recipients immediately and
  honor unsubscribes and complaints.
- Keep transactional and bulk traffic on separate sending identities when
  their volume or reputation differs.
- Monitor provider rejection codes, complaint reports, DMARC aggregate reports,
  and abrupt changes in daily volume.

## Inbound quarantine

Executable and disk-image attachments are quarantined before the message body
or download is exposed. Upstream spam headers and SPF/DKIM/DMARC failures
contribute to a bounded spam score. Administrators can maintain global sender
address/domain allow and block policies on the Sender policies page. An allow
policy can override spam-score quarantine, but never executable attachment
quarantine.

The Worker runtime cannot run a local antivirus engine. The quarantine boundary
is therefore the integration point for a future external scanner: scan the R2
object out of band, then release only objects with a verified clean verdict.
Until such a scanner is configured, quarantined objects remain inaccessible.
