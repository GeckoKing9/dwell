export const EXPECTED_PERMISSIONS = ['tabs', 'idle', 'storage', 'alarms', 'declarativeNetRequest'] as const;

export const SITE_PATTERNS = [
  'https://www.instagram.com/*',
  'https://instagram.com/*',
  'https://www.youtube.com/*',
  'https://m.youtube.com/*',
  'https://youtube.com/*',
  'https://www.facebook.com/*',
  'https://m.facebook.com/*',
  'https://facebook.com/*',
] as const;

export const EXPECTED_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'";

export const EXPECTED_RULESETS = [
  { id: 'instagram-reels', enabled: true },
  { id: 'youtube-shorts', enabled: true },
  { id: 'facebook-reels', enabled: true },
  { id: 'instagram-explore', enabled: false },
] as const;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function sameList(actual: unknown, expected: readonly string[]): boolean {
  const list = asArray(actual);
  return list.length === expected.length && list.every((item, i) => item === expected[i]);
}

function withinSites(actual: unknown): boolean {
  const list = asArray(actual);
  const allowed: readonly string[] = SITE_PATTERNS;
  return list.length > 0 && list.every((item) => typeof item === 'string' && allowed.includes(item));
}

export function manifestProblems(manifest: unknown): string[] {
  const problems: string[] = [];
  if (!isObject(manifest)) return ['manifest is not an object'];

  if (manifest.manifest_version !== 3) problems.push('manifest_version must be 3');
  if (!sameList(manifest.permissions, EXPECTED_PERMISSIONS)) {
    problems.push(`permissions must equal ${JSON.stringify(EXPECTED_PERMISSIONS)}`);
  }
  if ('optional_permissions' in manifest || 'optional_host_permissions' in manifest) {
    problems.push('optional permissions are not allowed');
  }
  if (!sameList(manifest.host_permissions, SITE_PATTERNS)) {
    problems.push('host_permissions must equal the literal site list');
  }
  if (manifest.incognito !== 'not_allowed') problems.push('incognito must be not_allowed');
  if ('externally_connectable' in manifest) problems.push('externally_connectable is not allowed');

  const csp = isObject(manifest.content_security_policy) ? manifest.content_security_policy.extension_pages : undefined;
  if (csp !== EXPECTED_CSP) problems.push(`content_security_policy.extension_pages must be ${EXPECTED_CSP}`);
  if (typeof csp !== 'string' || !csp.includes("default-src 'none'")) problems.push("CSP must contain default-src 'none'");

  const scripts = asArray(manifest.content_scripts);
  if (scripts.length === 0) problems.push('content_scripts missing');
  const covered = new Set<unknown>();
  scripts.forEach((entry, i) => {
    if (!isObject(entry)) {
      problems.push(`content_scripts[${i}] is not an object`);
      return;
    }
    if (!withinSites(entry.matches)) problems.push(`content_scripts[${i}].matches outside the site list`);
    asArray(entry.matches).forEach((m) => covered.add(m));
    if (entry.all_frames !== false) problems.push(`content_scripts[${i}].all_frames must be false`);
    if (entry.match_about_blank !== false) problems.push(`content_scripts[${i}].match_about_blank must be false`);
    if (entry.run_at !== 'document_start') problems.push(`content_scripts[${i}].run_at must be document_start`);
    if ('world' in entry) problems.push(`content_scripts[${i}].world is not allowed`);
  });
  if (scripts.length > 0 && covered.size !== SITE_PATTERNS.length) {
    problems.push('content_scripts must cover every site pattern');
  }

  asArray(manifest.web_accessible_resources).forEach((entry, i) => {
    if (!isObject(entry) || !withinSites(entry.matches)) {
      problems.push(`web_accessible_resources[${i}].matches outside the site list`);
    }
    if (isObject(entry) && 'extension_ids' in entry) {
      problems.push(`web_accessible_resources[${i}].extension_ids is not allowed`);
    }
  });

  const dnr = isObject(manifest.declarative_net_request) ? asArray(manifest.declarative_net_request.rule_resources) : [];
  const rulesets = dnr.map((r) => (isObject(r) ? { id: r.id, enabled: r.enabled } : null));
  if (JSON.stringify(rulesets) !== JSON.stringify(EXPECTED_RULESETS)) {
    problems.push(`declarative_net_request.rule_resources must be ${JSON.stringify(EXPECTED_RULESETS)}`);
  }

  if (JSON.stringify(manifest).includes('<all_urls>')) problems.push('<all_urls> is not allowed anywhere');
  if (/"(https?|\*):\/\/\*/.test(JSON.stringify(manifest))) problems.push('wildcard host patterns are not allowed');
  return problems;
}
