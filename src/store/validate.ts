/** Shared guards for untrusted values: imported files, stored records, settings patches. Pure. */

/** A lowercase hostname with at least one dot: what a grouped site id looks like. */
export const HOSTNAME_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
export const MAX_HOSTNAME_LENGTH = 253;

const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

export type Check<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Keys that can reach or replace an object's prototype. */
export function isForbiddenKey(key: string): boolean {
  return FORBIDDEN_KEYS.has(key);
}

/** True for a string that may be stored as a site id. */
export function isSiteId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_HOSTNAME_LENGTH &&
    HOSTNAME_RE.test(value) &&
    !isForbiddenKey(value)
  );
}

/** A JSON-style object: not null, not an array, prototype Object.prototype or null. */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isIntInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** An empty record with no prototype, so no key can collide with an inherited one. */
export function nullRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export interface KeyProblem {
  readonly forbidden: boolean;
  readonly reason: string;
}

/** The first forbidden or unknown own key of `obj`, or null when every key is allowed. */
export function keyProblem(obj: Record<string, unknown>, allowed: ReadonlySet<string>, where: string): KeyProblem | null {
  for (const key of Object.keys(obj)) {
    if (isForbiddenKey(key)) return { forbidden: true, reason: `${where} contains the forbidden key "${key}".` };
    if (!allowed.has(key)) return { forbidden: false, reason: `${where} has an unknown key "${key}".` };
  }
  return null;
}
