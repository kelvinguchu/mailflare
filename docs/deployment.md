# Deployment and configuration

This guide covers Cloudflare deployment, runtime configuration, and database backups.

## Deployment

Deploy from your controlled source checkout. The deployment flow reads `wrangler.jsonc`, provisions the required Worker bindings, builds the OpenNext Worker, applies D1 migrations, and deploys the app.

Keep `wrangler.jsonc` committed. Do not commit `.dev.vars`; enter secrets during Cloudflare setup or keep them in a local `.dev.vars` file.

## Required configuration

CC Mail needs these runtime values:

- `CF_TOKEN` — a scoped Cloudflare API token with Zone Read, Email Routing Edit, Email Sending Edit, and Email Routing Rules Write access for the domains you will connect. This is separate from the token Cloudflare uses to deploy the app.
- `CF_EMAIL_WORKER_NAME` — the deployed Worker name. It must match the Worker name exactly so CC Mail can create Email Routing rules.
- `CF_AID` — the Cloudflare account ID. This is optional for normal mail use but required for database backups.

You can use a legacy Global API Key instead of `CF_TOKEN` by setting both `CF_API_KEY` and `CF_EMAIL`.

Copy `.dev.vars.example` when configuring a local environment:

```bash
cp .dev.vars.example .dev.vars
```

Paste only the token value into `CF_TOKEN`; do not include `Bearer` and do not use the token ID.

## First-run setup

Open `/setup` after deployment. CC Mail checks the required runtime configuration and initializes an empty D1 database. It never applies later migrations to an existing database from the setup page.

Use the normal migration command when updating an existing installation:

```bash
npm run db:migrate:remote
```

## Manual deployment

Install dependencies, configure the Cloudflare bindings in `wrangler.jsonc`, and run:

```bash
npm install
npm run deploy
```

The deploy command builds the OpenNext application and uploads the complete Worker with Wrangler. The complete Worker is required because `worker.ts` also handles inbound email, queues, workflows, and the real-time Durable Object.

To migrate an existing remote D1 database before deploying, use:

```bash
npm run deploy:with-migrations
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

Backups require:

- `CF_AID`
- `D1_DATABASE_ID`
- `D1_BACKUP_TOKEN`, or a `CF_TOKEN` that is also allowed to export the D1 database

## Updating CC Mail

There is no automatic upstream updater. Review and merge chosen changes into your controlled repository, run the D1 migrations, test the application, and deploy from that repository. This prevents an upstream update from overwriting local customizations.
