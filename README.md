# Flowmail

Open-source lifecycle email for SaaS founders, running on your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yangkui/flowmail)

Flowmail is a Cloudflare-native email stack for one narrow job: import a user list, generate a compliant lifecycle email, approve a limited send, track clicks and unsubscribes, receive replies, and let an Agent draft follow-up responses.

## Who should deploy it

- SaaS founders and indie hackers already using Cloudflare for their domain.
- Open-source maintainers who want self-hosted project updates and reply handling.
- Product studios that prefer one isolated Cloudflare deployment per client.

Flowmail is not a Mailchimp, Customer.io, Mautic, or listmonk replacement. Use those if you need mature newsletter workflows, multi-step automation, CRM sync, or BI. Use Flowmail if you want a small open-source lifecycle email workflow that keeps contacts, replies, and sending permissions inside your Cloudflare account.

## What works in v0.1

- Deploy to Cloudflare compatible Worker app.
- Built-in admin password login for the admin UI.
- Setup wizard with Cloudflare Email checks, encrypted token storage, and reply-to routing.
- Single product configuration.
- CSV contact import with validation and dedupe.
- AI-assisted lifecycle email draft with deterministic fallback.
- Manual template edit and preview.
- Compliance checks before approval.
- Queue-backed campaign sending through Cloudflare Email Service.
- Click tracking and unsubscribe pages.
- Reply inbox through Cloudflare Email Routing.
- Agent reply drafts that require manual approval.
- English and Simplified Chinese UI catalogs.

## Stack

- Frontend: React 19, React Router v7, CSS.
- API: Hono on Cloudflare Workers.
- Storage: D1 for relational data, R2 for imports and raw inbound email.
- Jobs: one Cloudflare Queue for campaign sends.
- AI: Workers AI binding with safe fallback drafts.
- Email: Cloudflare Email Service and Email Routing.
- Auth: built-in admin password login.

## Quick start

```bash
npm install
npm run dev
```

Apply local D1 migrations when using Wrangler:

```bash
npx wrangler d1 migrations apply flowmail --local
```

## Deploy

1. Click the Deploy to Cloudflare button.
2. Open the deployed Worker and sign in with username `admin` and password `flowmail-admin`.
3. In the setup wizard, use the Create Flowmail token link, or open Dashboard > My Profile > API Tokens > Create Token > Custom token, then discover your zone and Worker and apply the reply-to route automatically.
4. Enable Cloudflare Email Routing for your domain if it is not already enabled.
5. Enable Cloudflare Email Service and verify your sending domain.

Flowmail initializes its D1 schema at runtime, so first-time Deploy to Cloudflare users do not need to run migrations before opening the setup wizard. Contributors can still apply migrations manually when developing locally.

Wrangler fallback:

```bash
npm install
npx wrangler d1 migrations apply flowmail --remote
npm run deploy
```

## Current limits

- Single organization and single product.
- No RBAC or multi-tenant SaaS control plane.
- No A/B testing, journey builder, CRM sync, or analytics warehouse.
- Email Service availability and limits depend on the deployed Cloudflare account.
- Saved Cloudflare API tokens are encrypted with an automatically generated instance key; create a Custom token from My Profile > API Tokens, not a Global API Key or Account API Token. Use Zone: Zone Read, Zone: DNS Read, Zone: Email Routing Rules Read/Edit, Account: Email Sending Write, and Account: Workers Scripts Read, then delete it from Settings when no longer needed.

## Documentation

- [Deployment](docs/deploy.md)
- [Architecture](docs/architecture.md)
- [Compliance](docs/compliance.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](SECURITY.md)

## License

Apache-2.0
