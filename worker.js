// Showcaller Studio website: static files from public/, plus the demo request form.
import { contact, json } from './contact.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/contact') {
      if (request.method !== 'POST') return json({ error: 'Use POST' }, 405);
      return contact(request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
