// Showcaller Studio website: static files from public/, plus the demo request form, the online store,
// the gothammediahouse.com project inquiry form, and the free Multiview app's download form and version check.
import { contact, json } from './contact.js';
import { checkout, webhook, orderStatus, storeOpen } from './store.js';
import { gmhInquiry } from './gmh-inquiry.js';
import { multiviewDownload, multiviewLatest } from './multiview.js';

const ROUTES = {
  '/api/contact': ['POST', contact],
  '/api/checkout': ['POST', checkout],
  '/api/stripe-webhook': ['POST', webhook],
  '/api/order': ['GET', orderStatus],
  '/api/store': ['GET', storeOpen],
  '/api/multiview': ['POST', multiviewDownload],
  '/api/multiview/latest': ['GET', multiviewLatest],
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
