# Deployment and configuration

This guide covers Cloudflare deployment environments, runtime configuration, and database backups.

## Deployment

Deploy from your controlled source checkout. `wrangler.jsonc` has three deliberately separate environments:

| Environment | Worker | Exposure | Provider delivery | Cloudflare management API |
| --- | --- | --- | --- | --- |
| Local default | `mailflare-local` | Local emulation only | Disabled; no Email Sending binding | Disabled |
| Staging | `mailflare-staging` | `mailflare-staging.agabio.workers.dev` | Disabled; no Email Sending binding | Disabled; no Cloudflare credential is installed |
| Production | `mailflare` | `mail.calibercode.io` | Enabled | Enabled with the production-only `CF_TOKEN` secret |

Bindings and variables are non-inheritable in named Wrangler environments. Every D1, R2, Queue, Durable Object, Workflow, rate-limit, Images, Assets and service binding is therefore declared explicitly for staging and production. The normal `npm run dev`, `npm run deploy`, `npm run upload`, and `npm run db:migrate:remote` paths cannot target production; production always requires a command containing `:production`.

The deployed resource inventory is:

| Resource | Staging | Production |
| --- | --- | --- |
| Worker | `mailflare-staging` | `mailflare` |
| D1 `DB` | `mailflare-staging` (`00c73577-0ef1-4d51-ba77-f09c06cfed1d`) | `mailflare` (`a9443977-88d2-46c1-bdc4-052784b445e8`) |
| R2 `BUCKET` | `mailflare-raw-staging` | `mailflare-raw` |
| Inbound Queue | `mailflare-inbound-staging` (`2f0fa4cc445d4badba3d9a985ff81f09`) | `mailflare-inbound` (`7848d13df94341c084029be469a50f50`) |
| Outbound Queue | `mailflare-outbound-staging` (`ab9c5a766d784dfdb7a51640c6bc90fc`) | `mailflare-outbound` (`d255fcaf65f54bce900a45ec59d7c091`) |
| Inbound dead-letter Queue | `mailflare-inbound-dlq-staging` (`1ca8336327334900af185457514a1c13`) | `mailflare-inbound-dlq` (`7201c3cd06f241db946a8afa4a314b94`) |
| Outbound dead-letter Queue | `mailflare-outbound-dlq-staging` (`3b76ce2c32594c1381a4ea3a95c8abb9`) | `mailflare-outbound-dlq` (`6af76949425045ecad4f2c875b1596af`) |
| Durable Object `REALTIME` | Worker-owned namespace `9a4463d1f334495aba590b346000f92d` | Worker-owned namespace `b737bf835175414f922a2727ed5b795c` |
| Workflow | `mailflare-database-backup-staging` | `mailflare-database-backup` |
| Cron | Disabled; scheduled handler remains deployable for a controlled test | `0 2 * * *` on the production Worker |
| Email Routing | No rule targets the staging Worker | Domain rules target `mailflare` |
| Email Sending | No binding; runtime mode is `disabled` | Unrestricted `EMAIL` binding; `calibercode.io` is enabled (tag `4c65a4d51af546fdbb837d7ee8151f58`); runtime mode is `enabled` |

The staging Worker cannot access production data because no production stateful identifier appears in its deployed binding manifest. It cannot send through the provider because it has no `EMAIL` binding and the queue consumer fails closed unless `OUTBOUND_DELIVERY_MODE=enabled`. It cannot change Email Routing or Email Sending configuration because `CLOUDFLARE_MANAGEMENT_MODE=disabled` and no Cloudflare API credential is installed.

Run `npm run check:environments` before a dry run or deployment. It rejects reused production identifiers, non-`-staging` resource names, staging custom routes, Email Sending bindings, active staging crons, externally owned Durable Objects, and enabled staging delivery or management modes.

### Safe deployment commands

The default remote commands deploy and migrate staging:

```bash
npm run db:migrate:remote
npm run deploy
```

Production requires an explicit command:

```bash
npm run db:migrate:production
npm run deploy:production
```

To promote the exact OpenNext artifact tested in staging without rebuilding it, build once and run both Worker-only commands from the same directory:

```bash
npm run build:worker
npm run deploy:worker:staging
# Validate the staging version here.
npm run deploy:worker:production
```

The Worker-only wrapper sets OpenNext's deployment guard and invokes Wrangler against `worker.ts`. Do not replace it with a direct `opennextjs-cloudflare deploy`: that generic path deploys only the generated Next Worker and omits CC Mail's email, queue, scheduled, Durable Object and Workflow exports.

Keep `wrangler.jsonc` committed. Do not commit `.dev.vars`; enter secrets during Cloudflare setup or keep them in a local `.dev.vars` file.

## Required configuration

CC Mail needs these runtime values:

- `CF_TOKEN` — a scoped Cloudflare API token with Zone Read, Email Routing Edit, Email Sending Edit, and Email Routing Rules Write access for the domains you will connect. This is separate from the token Cloudflare uses to deploy the app.
- `CF_EMAIL_WORKER_NAME` — the deployed Worker name. It must match the Worker name exactly so CC Mail can create Email Routing rules.
- `CF_AID` — the Cloudflare account ID retained for compatibility with existing deployments.
- `D1_DATABASE_ID` — the environment's D1 ID retained for compatibility; backups use the `DB` binding directly.
- `DEPLOYMENT_ENV` — `local`, `staging`, or `production`, used for operational identification.
- `CLOUDFLARE_MANAGEMENT_MODE` — fail-closed switch for zone, Email Routing and Email Sending management calls. Only production is `enabled`.
- `OUTBOUND_DELIVERY_MODE` — fail-closed switch for provider delivery. Only production is `enabled`.

Secret names and purposes:

- `CF_TOKEN` — production-only runtime credential for zone and email configuration. The staging Worker intentionally has no secrets.
- `TURNSTILE_SECRET_KEY` — optional per-environment server-side Turnstile verification secret.
- `CF_API_KEY` and `CF_EMAIL` — optional legacy Global API Key pair; do not configure these when `CF_TOKEN` is used.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — public build-time Turnstile site key; this is not a secret.

Never copy a production `.dev.vars` file into a build or staging directory. If staging later needs Turnstile, create a distinct staging widget and install only its staging secret with `wrangler secret put TURNSTILE_SECRET_KEY --env staging`.

You can use a legacy Global API Key instead of `CF_TOKEN` by setting both `CF_API_KEY` and `CF_EMAIL`.

Copy `.dev.vars.example` when configuring a local environment:

```bash
cp .dev.vars.example .dev.vars
```

Paste only the token value into `CF_TOKEN`; do not include `Bearer` and do not use the token ID.

## First-run setup

Open `/setup` after deployment. CC Mail checks the required runtime configuration and initializes an empty D1 database. It never applies later migrations to an existing database from the setup page.

Use the explicit production migration command when updating the production installation:

```bash
npm run db:migrate:production
```

## Manual deployment

Install dependencies, configure the Cloudflare bindings in `wrangler.jsonc`, and deploy staging first:

```bash
npm install
npm run deploy
```

The deploy command builds the OpenNext application and uploads the complete Worker with Wrangler. The complete Worker is required because `worker.ts` also handles inbound email, queues, workflows, and the real-time Durable Object.

To migrate and deploy production, use the explicit production command:

```bash
npm run deploy:production:with-migrations
```

Remote migrations require the target account's `database_id` in your local `wrangler.jsonc`. Do not commit an account-specific database ID to a reusable repository.

## Custom Worker names

If you rename the Worker, keep these values aligned:

- `name` in `wrangler.jsonc`
- `services[].service` for the `WORKER_SELF_REFERENCE` binding
- `CF_EMAIL_WORKER_NAME`

Cloudflare service bindings use a literal Worker name and cannot inherit the top-level `name` value automatically.

## Database backups

Manual and scheduled backups use the `DATABASE_BACKUP_WORKFLOW` binding declared in `wrangler.jsonc`. Deploy the complete Worker with `npm run deploy` whenever this binding is added or changed.

The Worker checks the automatic-backup settings at 02:00 UTC each day. Enable automatic backups from **Admin settings > Backups** and select the daily, weekly, or monthly frequency there.

Backup data is read through the `DB` binding and written through the `BUCKET` binding. No Cloudflare API token is required for the backup itself.

Backup format version 2 includes every table registered in the application schema. `_cf_KV`, `d1_migrations`, and `sqlite_sequence` are excluded because Cloudflare D1, the migration runner, and SQLite own them. Before each export, CC Mail rejects any D1 table that has not been classified as application data or database bookkeeping.

## Updating CC Mail

There is no automatic upstream updater. Review and merge chosen changes into your controlled repository, run the D1 migrations, test the application, and deploy from that repository. This prevents an upstream update from overwriting local customizations.
