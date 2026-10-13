// Showcaller Studio website: static files from public/, plus the demo request form, the online store
// and the gothammediahouse.com project inquiry form.
import { contact, json } from './contact.js';
import { checkout, webhook, orderStatus, storeOpen } from './store.js';
import { gmhInquiry } from './gmh-inquiry.js';

const ROUTES = {
  '/api/contact': ['POST', contact],
  '/api/checkout': ['POST', checkout],
  '/api/stripe-webhook': ['POST', webhook],
  '/api/order': ['GET', orderStatus],
  '/api/store': ['GET', storeOpen],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/gmh-inquiry') return gmhInquiry(request, env); // handles its own CORS and methods
    const route = ROUTES[url.pathname];
    if (route) {
      if (request.method !== route[0]) return json({ error: `Use ${route[0]}` }, 405);
      return route[1](request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
