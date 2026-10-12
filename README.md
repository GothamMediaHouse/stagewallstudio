# Showcaller Studio website

The public site for Showcaller Studio (formerly StageWall) by Gotham Media House. Plain static files, no build step.

- `public/`: the site itself (`index.html`, `media/`, icons, `_headers`)
- `worker.js`: serves `public/` and handles the demo request form at `/api/contact`
- `contact.js`: the form handler (sends the request through Resend)
- `wrangler.jsonc`: the Cloudflare Worker settings

Hosted as a Cloudflare Worker (stagewallstudio) connected to this repo: every push to `main` deploys.

## Demo request form

The form emails each request through [Resend](https://resend.com), with the visitor as Reply-To. Set these in Cloudflare → Workers & Pages → stagewallstudio → Settings → Variables and secrets:

- `RESEND_API_KEY` (secret): a Resend API key
- `CONTACT_TO`: where requests go (comma-separate several)
- `CONTACT_FROM`: the sender, e.g. `Showcaller Studio <hello@gothammediahouse.com>`; its domain must be verified in Resend (defaults to hello@showcallerstudio.com)
