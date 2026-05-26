# Troubleshooting

## Sign-in problems

The default username is `admin` and the default password is `flowmail-admin`.

## Click or unsubscribe links point to the wrong host

Open Flowmail from the final Worker route before approving a campaign. Flowmail remembers the last app origin automatically; `PUBLIC_APP_URL` is only an optional override.

## Campaign approval fails

Check:

- Product sender is saved through the Cloudflare Email config.
- Organization address is present.
- Contacts have `source` or `consent_source`.
- Contacts are not already unsubscribed or suppressed.
- Template contains unsubscribe copy or `{{unsubscribe_url}}`.

## Email does not send

Confirm Cloudflare Email Service is enabled and the sender domain is verified. Also check account-level sending limits.

## Replies do not appear

Enable Email Routing and route the target address or catch-all rule to the Worker. Raw inbound messages are written to R2 under `inbound/`.

## Replies appear but are not attributed

Flowmail first checks Flowmail headers, then message-id references, then the latest sent campaign for that sender address. Some email clients strip custom headers; message-id matching is the preferred fallback.
