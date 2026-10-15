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
