import { TWO_LEVEL_SUFFIXES } from './suffixes.ts';

/** A site id is plain DNS labels: no underscore, so no `__proto__`-style key can ever be one. */
const SITE_ID = /^[a-z0-9-]+(\.[a-z0-9-]+)*$/;
const HOST = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

function normalise(host: string): string {
  const lower = host.trim().toLowerCase().replace(/\.$/, '');
  const bare = lower.replace(/^www\./, '');
  return bare.includes('.') ? bare : lower;
}

/** Lowercased host without a leading `www.`, or null for anything that is not an http(s) page. */
function hostOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = normalise(parsed.hostname);
  if (host.startsWith('[')) return host;
  return HOST.test(host) ? host : null;
}

function isIp(host: string): boolean {
  return host.startsWith('[') || IPV4.test(host);
}

/** eTLD+1 using the bundled two-level suffix subset (KTD8). */
export function registrableDomain(host: string): string {
  if (isIp(host)) return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const keep = TWO_LEVEL_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

/** The host and each parent domain down to the registrable domain. */
function hostChain(host: string, domain: string): string[] {
  if (isIp(host)) return [host];
  const labels = host.split('.');
  const depth = domain.split('.').length;
  return labels.slice(0, labels.length - depth + 1).map((_, i) => labels.slice(i).join('.'));
}

/**
 * Site id for a URL (R8, R9): the registrable domain, or the exact host when it is listed in
 * `overrides`; null for non-http(s) URLs and for hosts at or under an `ignore` entry (R7).
 */
export function siteOf(url: string, overrides: readonly string[], ignore: readonly string[]): string | null {
  const host = hostOf(url);
  if (host === null) return null;
  const domain = registrableDomain(host);
  const site = overrides.some((o) => normalise(o) === host) ? host : domain;
  if (!isIp(site) && !SITE_ID.test(site)) return null;
  const ignored = new Set(ignore.map(normalise));
  return hostChain(host, domain).some((h) => ignored.has(h)) ? null : site;
}

export function isTrackableUrl(url: string): boolean {
  return siteOf(url, [], []) !== null;
}
