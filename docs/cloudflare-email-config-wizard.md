# Cloudflare Email Config Wizard

## Purpose

Flowmail already has the core email runtime:

- Outbound mail is sent through the Cloudflare Email Service binding in `workers/email-sender.ts`.
- Inbound mail is received by the Worker `email()` handler in `workers/app.ts`.
- Product sender settings already store `default_from_email`, `reply_to_email`, and `sending_domain`.

This change adds the missing control plane: a UI-driven way to connect a Cloudflare zone, check the account state, and configure one reply-to address to route inbound messages to the Flowmail Worker.

## Reference Code Policy

Borrow only the Cloudflare API ideas from `/Users/yangkui/workspace/444-main-2-main`:

- Token verification.
- Zone lookup by name.
- DNS and Email Routing status checks.
- Create/update Cloudflare Email Routing rules.

Do not migrate:

- Random subdomain pools.
- IMAP OTP polling.
- DomainPool burn/cooldown/cleanup.
- Payment, registration, proxy, or anti-abuse workflow code.
- Catch-all routing as the default behavior.

## Product Behavior

Setup step 1 becomes a token-first Cloudflare Email wizard:

1. Load saved Cloudflare email config.
2. Let the operator enter or update:
   - Cloudflare user API token from the setup page's Create Flowmail token link, or Dashboard > My Profile > API Tokens > Create Token > Custom token.
   - Cloudflare zone, selected from discovered zones when the token can list them.
   - Worker, selected from discovered Workers when the token can list them.
   - From email and reply-to email, prefilled as `hello@<zone>` and `support@<zone>`.
3. Save the config. The token is encrypted only on save; discovery does not persist plaintext tokens.
4. Run a check:
   - Token saved and decryptable.
   - Token is active.
   - Zone exists and is accessible.
   - Email Routing status for the zone.
   - DNS counts for MX, SPF, DKIM-like TXT, and DMARC records.
   - Whether the exact reply-to address already routes to the Worker.
5. Apply routing:
   - Create or update a single literal recipient rule.
   - Route `reply_to_email` to the configured Worker.
6. Send a test email through the existing test-email API.

Settings adds the same Cloudflare Email configuration block for second edits after onboarding.

## API Contract

All routes are protected by the existing `/api/*` access middleware.

### `GET /api/v1/cloudflare/email-config`

Returns the saved config with no plaintext token:

```json
{
  "zoneName": "example.com",
  "workerName": "flowmail",
  "fromEmail": "hello@example.com",
  "replyToEmail": "support@example.com",
  "tokenSaved": true,
  "tokenLast4": "abcd",
  "updatedAt": "2026-05-12T00:00:00.000Z"
}
```

### `POST /api/v1/cloudflare/email-config/discover`

Request:

```json
{
  "token": "temporary-token-used-for-discovery",
  "zoneName": "optional.example.com"
}
```

Behavior:

- Verifies the token.
- Lists accessible zones.
- Selects the requested zone or the first accessible zone.
- Lists Workers from the selected zone's account when the token includes Workers read access.
- Returns suggested values for the remaining setup fields.
- Does not save the token.

Response:

```json
{
  "ok": true,
  "token": { "active": true },
  "zones": [{ "id": "...", "name": "example.com", "status": "active", "accountId": "..." }],
  "selectedZone": { "id": "...", "name": "example.com", "status": "active", "accountId": "..." },
  "workers": [{ "id": "flowmail", "name": "flowmail" }],
  "suggested": {
    "zoneName": "example.com",
    "workerName": "flowmail",
    "fromEmail": "hello@example.com",
    "replyToEmail": "support@example.com"
  },
  "warnings": []
}
```

### `PUT /api/v1/cloudflare/email-config`

Request:

```json
{
  "zoneName": "example.com",
  "workerName": "flowmail",
  "fromEmail": "hello@example.com",
  "replyToEmail": "support@example.com",
  "token": "optional-new-token"
}
```

Behavior:

- Save zone, worker, from, and reply-to fields.
- If `token` is present and non-empty, encrypt and save it.
- If `token` is omitted, keep the existing saved token.
- If `token` is present, encrypt it with the instance encryption key. Flowmail generates this key automatically when no Worker secret override is present.
- Also update the product sender fields so the wizard and product settings stay aligned:
  - `default_from_email = fromEmail`
  - `reply_to_email = replyToEmail`
  - `sending_domain = domain(fromEmail) || zoneName`

### `POST /api/v1/cloudflare/email-config/check`

Uses the saved encrypted token. Returns:

```json
{
  "ok": true,
  "checks": [
    { "name": "token", "ok": true, "details": "Token active." },
    { "name": "zone", "ok": true, "details": "example.com is accessible." },
    { "name": "emailRouting", "ok": true, "details": "Email Routing enabled." },
    { "name": "replyToRoute", "ok": false, "details": "support@example.com is not routed to flowmail." }
  ],
  "zone": { "id": "...", "name": "example.com", "status": "active" },
  "dns": { "mxRecords": 3, "spfRecords": 1, "dkimHints": 1, "dmarcRecords": 1 },
  "routing": {
    "enabled": true,
    "status": "enabled",
    "replyToRule": null
  }
}
```

### `POST /api/v1/cloudflare/email-config/apply-routing`

Creates or updates one rule:

- Rule name: `Flowmail inbound: <reply_to_email>`.
- Matcher: literal `to == reply_to_email`.
- Action: route to Worker `<workerName>`.
- Does not create catch-all rules.
- Does not delete unrelated routing rules.

### `DELETE /api/v1/cloudflare/email-config/token`

Removes the saved encrypted token and token metadata while keeping non-secret config fields.

## Storage And Security

Use the existing `settings` table key `cloudflare_email_config`.

Persisted value shape:

```json
{
  "zoneName": "example.com",
  "workerName": "flowmail",
  "fromEmail": "hello@example.com",
  "replyToEmail": "support@example.com",
  "tokenCiphertext": "...",
  "tokenIv": "...",
  "tokenLast4": "abcd",
  "updatedAt": "2026-05-12T00:00:00.000Z"
}
```

Security requirements:

- Never return plaintext tokens from API responses.
- Never log token values.
- Never save a token in plaintext.
- The encryption key is a Worker secret, not a D1 setting.
- Accept tokens only through authenticated API routes.
- In product copy, explicitly tell users not to use Global API Key or Account API Tokens.
- Keep token permissions minimal:
  - Zone: Zone Read.
  - Zone: DNS Read.
  - Zone: Email Routing Rules Read.
  - Zone: Email Routing Rules Edit.
  - Account: Email Sending Write.
  - Account: Workers Scripts Read.

## Env Changes

Add to `Env`:

- `CONFIG_ENCRYPTION_KEY?: string` optional override; Flowmail auto-generates an instance key by default.
- `WORKER_NAME?: string`

Add `WORKER_NAME` as an optional var defaulting to `flowmail`.

## Test Checklist

Documentation:

- [ ] Explains migrated and non-migrated reference behavior.
- [ ] Explains why Flowmail needs Email Routing and Worker routing.
- [ ] Explains token security boundaries.

Backend:

- [ ] Missing `CONFIG_ENCRYPTION_KEY` still allows token saves using the generated instance key.
- [ ] `GET config` never returns plaintext token.
- [ ] `DELETE token` removes token metadata and leaves zone/worker/from/reply-to.
- [ ] `check` returns token, zone, DNS, Email Routing, and reply-to rule status.
- [ ] `apply-routing` creates or updates only the configured literal reply-to rule.
- [ ] Cloudflare API failures become readable JSON errors.

Frontend:

- [ ] Setup step 1 supports save, check, apply routing, delete token, and test email.
- [ ] Settings supports the same second-edit workflow.
- [ ] Existing product sender form remains usable.
- [ ] Saved Cloudflare email values sync with product sender values.

Validation:

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] Tests mock Cloudflare API and do not require a real Cloudflare account.
