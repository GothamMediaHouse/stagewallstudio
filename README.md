# Showcaller Studio website

The public site for Showcaller Studio (formerly StageWall) by Gotham Media House. Plain static files, no build step.

- `public/`: the site itself (`index.html`, `media/`, icons, `_headers`)
- `worker.js`: serves `public/` and handles the demo request form at `/api/contact`
- `contact.js`: the form handler (sends the request through Resend)
- `gmh-inquiry.js`: the gothammediahouse.com project inquiry form handler (see below)
- `multiview.js`, `tools.js`: the free apps' sign-up forms and version checks (see below)
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

## Showcaller Multiview (free download)

`public/multiview/` is the page for the free multiviewer app; `multiview.js` handles its download form (`POST /api/multiview`) and the version check the app makes (`GET /api/multiview/latest`). The form emails the visitor the download links and sends a note to `CONTACT_TO`, using the Resend settings above. Until the links are set it collects emails for a waiting list instead.

- `MULTIVIEW_VERSION`: the current version, e.g. `1.4.1`. Copies of the app older than this show "Update available".
- `MULTIVIEW_MAC_ARM_URL`, `MULTIVIEW_MAC_INTEL_URL`, `MULTIVIEW_WIN_URL` (optional): public download links for each installer (any https link, e.g. a Cloudflare R2 bucket or a Google Drive file shared with "Anyone with the link").
- `MULTIVIEW_NOTES` (optional): one line on what's new, shown in the app's update note.

## Free tools

`public/tools/` lists the free tools; `public/led-wall-calculator/` is the LED wall calculator (all in the page, nothing sent to the Worker). The panel presets and their sources are at the top of its script: keep a source note on any you add.

`tools.js` handles the "Get notified" forms on the tools page (`POST /api/notify` with `tool`: `multiview`, `timer`, `testkit` or `companion`) and emails `CONTACT_TO` saying which tool, using the Resend settings above. `multiview` goes through the Multiview handler, so it behaves as the form on `/multiview/` does; `/api/multiview` is unchanged. It also answers the version checks the coming apps make, in the same shape as `/api/multiview/latest`:

- `GET /api/timer/latest`: version from `TIMER_VERSION` (and `TIMER_NOTES`), `null` until set
- `GET /api/testkit/latest`: version from `TESTKIT_VERSION` (and `TESTKIT_NOTES`), `null` until set

## App updates (one click)

Every Showcaller app (Multiview, Timer, Test Kit, Replay, ISO, Switcher, NDI Webcam) asks `GET /api/<app>/latest` on start and from Help → Check for Updates. When `public/updates/<app>/latest.json` is there, the answer also carries a signed update zip: the app shows "Update available", downloads the zip, checks its signature against the update key, installs it and restarts. Settings and licenses stay. `updates.js` handles this; for Multiview, Timer and Test Kit a newer zip wins over the older Cloudflare variables above.

To publish an update:

1. On the Mac: `node sc-update.js pack "<app folder>" "../../Showcaller Studio Admin (keep private)/update-key.pem"` from inside the app's folder. It makes `<name>-update-<version>.zip` in `Documents/Showcaller/Releases` from the files in the app's `build.files`, signs it, and prints its `sha256` and `size`.
2. Here: put the zip in `public/updates/<app>/` and write `public/updates/<app>/latest.json`:
   `{ "version": "1.6.3", "notes": "One line on what's new", "zip": "/updates/<app>/<file>.zip", "sha256": "…", "size": 123456 }`
3. Push to `main`. Apps see it within five minutes.

Update zips hold only the app's own code (no Electron, no libraries), so they're small, but each must stay under Cloudflare's 25 MB asset limit. An update that adds a new library needs a full rebuild instead; the app says so and points to the download page. Keep a zip's old versions out of the repo: delete the previous zip when you add a new one.

The update key is `update-key.pem` in "Showcaller Studio Admin (keep private)", the same key as Showcaller Studio's updates. Without it no app can be updated, so keep a backup.
