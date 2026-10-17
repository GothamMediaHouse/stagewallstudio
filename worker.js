// Showcaller Studio website: static files from public/, plus the demo request form, the online store,
// the gothammediahouse.com project inquiry form, the free Multiview app's download form and version check,
// the free tools page's waiting lists, every app's version check and one-click update (updates.js), and
// Showcaller Hub's app list with full downloads from GitHub releases (hub.js).
import { contact, json } from './contact.js';
import { checkout, webhook, orderStatus, storeOpen } from './store.js';
import { gmhInquiry } from './gmh-inquiry.js';
import { multiviewDownload, multiviewLatest } from './multiview.js';
import { toolNotify, timerLatest, testkitLatest } from './tools.js';
import { APPS, latestWithUpdate } from './updates.js';
import { hubCatalog, download } from './hub.js';

const ROUTES = {
  '/api/contact': ['POST', contact],
  '/api/checkout': ['POST', checkout],
  '/api/stripe-webhook': ['POST', webhook],
  '/api/order': ['GET', orderStatus],
  '/api/store': ['GET', storeOpen],
  '/api/multiview': ['POST', multiviewDownload],
  '/api/multiview/latest': ['GET', latestWithUpdate('multiview', multiviewLatest)],
  '/api/notify': ['POST', toolNotify],
  '/api/timer/latest': ['GET', latestWithUpdate('timer', timerLatest)],
  '/api/testkit/latest': ['GET', latestWithUpdate('testkit', testkitLatest)],
  '/hub/catalog.json': ['GET', hubCatalog],
};
for (const app of Object.keys(APPS)) ROUTES[`/api/${app}/latest`] ||= ['GET', latestWithUpdate(app)];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/gmh-inquiry') return gmhInquiry(request, env); // handles its own CORS and methods
    if (url.pathname.startsWith('/download/') && request.method === 'GET') return download(request, env);
    const route = ROUTES[url.pathname];
    if (route) {
      if (request.method !== route[0]) return json({ error: `Use ${route[0]}` }, 405);
      return route[1](request, env);
    }
    return env.ASSETS.fetch(request);
  },
};
