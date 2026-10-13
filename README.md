# Showcaller Studio website

The public site for Showcaller Studio (formerly StageWall) by Gotham Media House. Plain static files, no build step.

- `public/`: the site itself (`index.html`, `media/`, icons, `_headers`)
- `worker.js`: serves `public/` and handles the demo request form at `/api/contact`
- `contact.js`: the form handler (sends the request through Resend)
- `gmh-inquiry.js`: the gothammediahouse.com project inquiry form handler (see below)
- `store.js`: buying online through Stripe Checkout (license key made and emailed after payment)
- `public/thanks.html`: the page after paying, which shows the key
- `wrangler.jsonc`: the Cloudflare Worker settings

Hosted as a Cloudflare Worker (stagewallstudio) connected to this repo: every push to `main` deploys.

## Demo request form

The form emails each request through [Resend](https://resend.com), with the visitor as Reply-To. Set these in Cloudflare → Workers & Pages → stagewallstudio → Settings → Variables and secrets:

- `RESEND_API_KEY` (secret): a Resend API key
- `CONTACT_TO`: where requests go (comma-separate several)
- `CONTACT_FROM`: the sender, e.g. `Showcaller Studio <hello@gothammediahouse.com>`; its domain must be verified in Resend (defaults to hello@showcallerstudio.com)

## gothammediahouse.com inquiry form

The project inquiry form on gothammediahouse.com (a static GitHub Pages site) posts to `/api/gmh-inquiry` on this Worker (`gmh-inquiry.js`), so it can reuse the Resend settings above. Only requests from gothammediahouse.com are allowed by CORS. Inquiries are sent from the `CONTACT_FROM` address under the name "Gotham Media House website" to `info@gothammediahouse.com`; set `GMH_INQUIRY_TO` to send them somewhere else.
## Buying online (Stripe)

The **Buy now** button under the price calculator stays hidden until these are set. After payment, Stripe calls `/api/stripe-webhook`; the Worker makes a license key signed with the web store key (the app trusts it from 7.4.28), emails it to the buyer with a copy to `CONTACT_TO`, and keeps it on the payment in Stripe. The thank-you page shows it too.

1. Stripe → Developers → API keys: copy the **Secret key** into `STRIPE_SECRET_KEY` (secret). A `sk_test_` key works for trying it with Stripe's test cards.
2. Stripe → Developers → Webhooks → Add endpoint: `https://showcallerstudio.com/api/stripe-webhook`, events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its **Signing secret** into `STRIPE_WEBHOOK_SECRET` (secret).
3. `LICENSE_SIGNING_KEY` (secret): the one line in `web-store-key-for-cloudflare.txt` in the private Admin folder. Never put it anywhere else.

Prices are worked out in `store.js` (and shown by the calculator in `index.html`): keep the two in step.
