# Deploy Flowmail to Cloudflare

## Deploy to Cloudflare

Use the button in the README. The deployment reads `wrangler.jsonc` and provisions the Worker bindings declared there.

Optional values:

- `DEFAULT_LOCALE`: `en` or `zh-CN`.
- `DAILY_SEND_LIMIT`: rolling 24-hour campaign send cap.
- `SEND_RATE_PER_MINUTE`: queue send cap per rolling minute.
- `WORKER_NAME`: Worker service name used by the setup wizard when creating Email Routing worker actions. Defaults to `flowmail`.

The Worker initializes the D1 schema when setup first loads. It also creates the tracking secret, token-encryption key, and remembered app URL at runtime, so first-time Deploy to Cloudflare users should be able to open the setup wizard immediately after deployment.

## Wrangler fallback

```bash
npm install
npx wrangler d1 migrations apply flowmail --remote
npm run deploy
```

## After deploy

1. Open Flowmail and sign in with username `admin` and password `flowmail-admin`.
2. Enable Email Routing for the domain if needed.
3. Route replies to the Worker email handler manually, or paste a scoped Cloudflare user API token in the setup wizard so Flowmail can discover your zone/Worker and apply the reply-to route there. Use the Create Flowmail token link in setup, or create it from Dashboard > My Profile > API Tokens > Create Token > Custom token.
4. Enable Cloudflare Email Service.
5. Verify the sending domain.

The setup wizard can use a Cloudflare API token to discover account state before saving anything. If you save the token, Flowmail encrypts it and can create/update the configured reply-to Email Routing rule. Use a Custom token from My Profile > API Tokens, not a Global API Key or Account API Token. Grant Zone: Zone Read, Zone: DNS Read, Zone: Email Routing Rules Read/Edit, Account: Email Sending Write, and Account: Workers Scripts Read.
