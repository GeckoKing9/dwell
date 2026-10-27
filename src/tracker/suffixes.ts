/**
 * Two-level public suffixes under which a site is the third label (bbc.co.uk, not co.uk).
 * A bundled subset of the Public Suffix List (KTD8): small and auditable; a wrong grouping
 * for an exotic suffix is fixed with a user override.
 */
export const TWO_LEVEL_SUFFIXES: ReadonlySet<string> = new Set([
  // United Kingdom
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk', 'sch.uk', 'nhs.uk',
  // Australia, New Zealand
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'id.au', 'asn.au',
  'co.nz', 'org.nz', 'net.nz', 'govt.nz', 'ac.nz',
  // Canada (provinces and federal government)
  'qc.ca', 'on.ca', 'bc.ca', 'ab.ca', 'mb.ca', 'sk.ca', 'ns.ca', 'nb.ca', 'nl.ca', 'pe.ca', 'gc.ca',
  // Asia
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in',
  'co.kr', 'or.kr', 'go.kr',
  'com.sg', 'gov.sg', 'edu.sg',
  'com.hk', 'gov.hk', 'edu.hk',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.tw', 'gov.tw',
  'co.id', 'com.my', 'com.ph', 'com.vn', 'co.th', 'com.pk', 'co.il',
  // Americas
  'com.br', 'net.br', 'org.br', 'gov.br',
  'com.mx', 'org.mx', 'gob.mx',
  'com.ar', 'gob.ar', 'com.co', 'com.pe',
  // Europe, Africa, Middle East
  'com.tr', 'gov.tr', 'com.pl', 'com.ua', 'co.at',
  'co.za', 'org.za', 'gov.za', 'com.ng', 'co.ke', 'com.eg', 'com.sa',
]);

/**
 * Hosting suffixes from the private section of the Public Suffix List, checked against the list on
 * 2026-10-27: under each, every customer owns one more label (alice.github.io), so that label is the
 * site. CDN suffixes are left out on purpose: their extra label is a random id nobody would recognise.
 */
export const HOSTED_SUFFIXES: ReadonlySet<string> = new Set([
  'github.io', 'gitlab.io', 'readthedocs.io', 'webflow.io', 'ngrok.io',
  'vercel.app', 'netlify.app', 'web.app', 'framer.app', 'replit.app', 'ngrok.app', 'ngrok-free.app',
  'pages.dev', 'workers.dev', 'fly.dev', 'deno.dev',
  'herokuapp.com', 'firebaseapp.com', 'appspot.com', 'onrender.com', 'blogspot.com', 'myshopify.com',
  'azurewebsites.net', 'duckdns.org', 'hf.space', 'repl.co', 'surge.sh',
]);

/**
 * Tailscale's `ts.net` (in the list as a suffix): the label under it is the tailnet, a random name, and
 * the one under that is the machine a person knows it by (privacypi.tail5e7cff.ts.net), so the machine
 * is the site.
 */
export const MACHINE_SUFFIXES: ReadonlySet<string> = new Set(['ts.net']);
