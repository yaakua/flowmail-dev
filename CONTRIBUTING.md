# Contributing

Flowmail is intentionally narrow. Contributions should strengthen the Cloudflare-native lifecycle email path: setup, sender configuration, contact import, compliant campaign send, reply handling, Agent drafts, docs, and tests.

## Development

```bash
npm install
npm run dev
npm test
npm run typecheck
```

Use focused PRs. Avoid broad UI rewrites, multi-tenant features, CRM integrations, large analytics systems, or automation builders unless the maintainers have accepted the scope first.

## Pull request checklist

- Keep high-risk sending actions behind manual approval.
- Do not bypass suppression, unsubscribe, consent source, or sender-domain checks.
- Add or update tests for shared email/compliance logic.
- Update docs when Cloudflare resources, env vars, migrations, or deployment steps change.
- Do not include real contact lists, tokens, raw emails, or customer data in issues or fixtures.
