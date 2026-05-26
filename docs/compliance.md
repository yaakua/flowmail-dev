# Compliance

Flowmail is built for permission-based lifecycle email, not cold email or purchased lists.

## Send-time checks

Before a campaign is queued:

- From email must use a configured sending domain.
- Organization contact address must be present.
- Template must include unsubscribe text or `{{unsubscribe_url}}`.
- Audience must contain at least one eligible recipient.
- Suppressed, bounced, and unsubscribed contacts are excluded.
- Manual suppression entries are available from the Contacts view.
- Contacts without source or consent source block sending.
- Risky subject patterns are flagged.

## Operator rules

- Keep source and consent fields when importing contacts.
- Do not upload purchased lists.
- Do not remove unsubscribe links.
- Do not raise send limits to bypass Cloudflare or account limits.
- Review every Agent-generated email before sending.
- Send setup test emails before approving a real campaign.

## Privacy defaults

- Cloudflare API tokens saved during setup are encrypted with an automatically generated instance key and are never returned to the browser as plaintext.
- Raw inbound emails are stored in R2 for operator review.
- Deleting and export workflows are planned for a later release.
