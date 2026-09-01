<p align="center">
  <img src="/public/cc-mail-logo.png" alt="CC Mail" width="96" />
</p>

# CC Mail

CC Mail is a self-hosted email inbox for custom domains, built on Cloudflare.

![CC Mail inbox](/screenshot.png)

## What you can do

- Connect domains and set up Cloudflare Email Routing from the dashboard.
- Create personal and shared mailboxes with delegated access.
- Send and receive email with attachments, rich formatting, signatures, and automatic replies.
- Organize mail with search, custom folders, stars, snoozing, archive, spam, and trash.
- Create routing rules to store, forward, reject, or categorize incoming messages.
- Get real-time inbox updates and new-message notifications.
- Import and export mail, manage contacts, and block unwanted senders.
- Manage accounts, permissions, API keys, webhooks, audit logs, and database backups.

## How it works

CC Mail runs in your Cloudflare account. Email Routing delivers incoming messages to the app, while Cloudflare's email service handles outgoing messages. Your mail data stays in your own D1 database and attachments are stored in your own R2 bucket.

## How much does it cost?

You can set up CC Mail and receive email for free.

A [Paid Worker](https://developers.cloudflare.com/workers/platform/pricing/) plan ($5/month) is required to send email (and it's recommend to have a smooth experience)

## Deploy

Deploy this repository from your controlled source checkout. You will need:

- A Cloudflare account.
- A domain managed by Cloudflare.
- A Cloudflare API token that CC Mail can use to configure email routing.

Install dependencies, configure `wrangler.jsonc`, apply the migrations, and deploy:

```bash
npm install
npm run deploy:with-migrations
```

After deployment, open your CC Mail URL and follow the first-run setup. The setup checks your Cloudflare configuration, creates the initial account, and helps you connect your first domain.

See the [deployment guide](docs/deployment.md) for required permissions, deployment, backups, and custom Worker names.

## Local development

```bash
cp .dev.vars.example .dev.vars
npm install
npm run db:migrate:local
npm test
npm run dev
```

Add your Cloudflare credentials to `.dev.vars`, then open [http://localhost:3000](http://localhost:3000). For sample local data, run `npm run db:seed` while the development server is running.

## Documentation

- [Deployment and configuration](docs/deployment.md)
- [API and integrations](docs/api.md)
- [Troubleshooting](docs/troubleshooting.md)

## License

CC Mail is based on Mailflare. See [LICENSE](LICENSE).
