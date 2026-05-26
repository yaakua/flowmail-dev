# Flowmail

Flowmail is an open-source, Cloudflare-native lifecycle email tool for small SaaS teams, indie hackers, and product studios that want to run a simple email workflow inside their own Cloudflare account.

It is built for one practical job:

> Import a contact list, draft a lifecycle email, review compliance, send a controlled batch, track clicks and unsubscribes, receive replies, and draft follow-up responses.

Flowmail is intentionally not a Mailchimp, Customer.io, Mautic, or listmonk replacement. Use those products if you need mature newsletters, journey automation, CRM sync, A/B testing, BI exports, or a multi-tenant marketing platform. Use Flowmail if you want a small self-hosted workflow where contacts, replies, campaign records, and Cloudflare setup stay under your own account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yaakua/flowmail)

## Goals

- Make self-hosted lifecycle email setup fast for Cloudflare users.
- Keep operational data in the deployer's Cloudflare account.
- Provide a small operator console for campaign drafting, approval, sending, reply triage, and follow-up.
- Avoid asking users to manually provision databases, object storage, queues, or secrets during the happy path.
- Keep Cloudflare API tokens scoped, encrypted, and removable.

## Features

- Cloudflare Worker app with React Router admin UI.
- Built-in admin password login.
- Cloudflare Email setup wizard with token-first discovery.
- Encrypted Cloudflare API token storage.
- Automatic Email Routing rule creation for reply-to addresses.
- CSV contact import with validation, dedupe, and import reports.
- Product profile and sender configuration.
- AI-assisted lifecycle email drafting with deterministic fallback.
- Template preview and manual editing.
- Compliance checks before campaign approval.
- Queue-backed batch sending through Cloudflare Email Service.
- Click tracking with wrapped redirect links.
- Unsubscribe pages and suppression handling.
- Reply inbox through Cloudflare Email Routing.
- Agent reply drafts that require manual approval.
- English and Simplified Chinese UI catalogs.

## Stack

- Frontend: React 19, React Router v7, CSS.
- API: Hono on Cloudflare Workers.
- Storage: D1 for relational data.
- Files: R2 for imports and raw inbound email.
- Jobs: Cloudflare Queues for campaign sends.
- AI: Workers AI binding with safe fallback drafts.
- Email: Cloudflare Email Service and Email Routing.

## Deployment

The recommended path is the Deploy to Cloudflare button above. The Worker configuration provisions the required Cloudflare bindings declared in `wrangler.jsonc`.

After deployment:

1. Open the deployed Worker.
2. Sign in with username `admin` and password `flowmail-admin`.
3. In setup, create or paste a scoped Cloudflare user API token.
4. Let Flowmail discover your zone and Worker.
5. Enable Cloudflare Email Routing if needed.
6. Enable Cloudflare Email Service and verify the sending domain.
7. Apply the reply-to route and send a test email.

Flowmail initializes its D1 schema at runtime. It also generates internal signing and encryption secrets automatically when no Worker secret override is provided.

### Custom Domain

For production, bind a custom domain such as `flowmail.example.com` to the Worker in Cloudflare. Open Flowmail from that domain before approving a campaign. Flowmail remembers the app origin and uses it for wrapped click links and unsubscribe links.

`PUBLIC_APP_URL` remains an optional advanced override if you need to pin the app URL explicitly.

### Local Development

```bash
npm install
npm run dev
```

Apply local D1 migrations when using Wrangler:

```bash
npx wrangler d1 migrations apply flowmail --local
```

Wrangler deploy fallback:

```bash
npm install
npx wrangler d1 migrations apply flowmail --remote
npm run deploy
```

## Security And Sensitive Data

Do not commit real secrets, contact lists, raw customer emails, or private replies.

The repository intentionally ignores local secret files and generated artifacts:

- `.dev.vars`
- `.env`
- `.env.*` except `.env.example`
- `.wrangler/`
- `.react-router/`
- `build/`
- `dist/`
- `worker-configuration.d.ts`
- `*.tsbuildinfo`

Cloudflare API tokens used by the setup wizard are encrypted before storage and are never returned to the browser as plaintext. Use a scoped custom user API token, not a Global API Key.

Default admin credentials are meant to get a new self-hosted deployment started. Change or protect access before using Flowmail with real data.

## Current Limits

- Single organization and single product.
- No per-user RBAC.
- No multi-tenant SaaS control plane.
- No journey builder, A/B testing, CRM sync, or analytics warehouse.
- Email Service availability and limits depend on the deployed Cloudflare account.
- Deletion/export workflows are planned but not complete.

## Documentation

- [Deployment](docs/deploy.md)
- [Architecture](docs/architecture.md)
- [Compliance](docs/compliance.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Security](SECURITY.md)

## License

Apache-2.0
