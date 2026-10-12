# Showcaller Studio website

The public site for Showcaller Studio (formerly StageWall) by Gotham Media House. Plain static files, no build step.

- `index.html`: the page
- `media/`: screenshots, the run-through videos and posters
- `favicon-32.png`, `apple-touch-icon.png`: icons

Hosted on Cloudflare Pages, connected to this repo: every push to `main` goes live. Build command: none. Output directory: `/`.

## Demo request form

The "Book a demo" form posts to `/api/contact` (`functions/api/contact.js`, a Cloudflare Pages Function), which emails the request through [Resend](https://resend.com) with the visitor as Reply-To. Set these in Cloudflare Pages → Settings → Variables and secrets, then redeploy:

- `RESEND_API_KEY` (secret): a Resend API key
- `CONTACT_TO`: where requests go (comma-separate several)
- `CONTACT_FROM` (optional): defaults to `Showcaller Studio <hello@showcallerstudio.com>`; its domain must be verified in Resend
