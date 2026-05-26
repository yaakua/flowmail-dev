# Security Policy

Report security issues privately. Do not open public issues containing tokens, real contact lists, raw customer emails, private replies, or Cloudflare account details.

Security-sensitive areas include:

- Cloudflare Access enforcement.
- Email sending authorization.
- Suppression and unsubscribe bypasses.
- Tracking and unsubscribe token leakage.
- HTML email sanitization and XSS.
- Prompt injection through inbound email or crawled product docs.
- R2 access to raw inbound email.
- Any path that allows an Agent to send or delete without human approval.

## Supported version

The project is pre-1.0. Security fixes target the latest `main` branch until versioned releases are established.

## Operational guidance

- Always configure Cloudflare Access in production.
- Rotate `TRACKING_SECRET` if token leakage is suspected.
- Use scoped, temporary Cloudflare API tokens for setup checks.
- Do not store Cloudflare API tokens in D1, R2, logs, or client-side state.
- Keep Email Service and Email Routing limits visible to operators.
