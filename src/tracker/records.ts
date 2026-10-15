/**
 * Plain-object maps keyed by site, tab or window id. Reads see own keys only, so an id such as
 * `constructor` never resolves to a prototype member; writes use computed keys or
 * `Object.fromEntries`, which define data properties, so `__proto__` stays an ordinary key.
 */
export function own<T>(record: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function without<T>(record: Record<string, T>, drop: (key: string, value: T) => boolean): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key, value]) => !drop(key, value)));
}
