/**
 * The guard's two logs (`blocker/guard-machine.ts`): the redirects it made and the undos it did in this tab
 * (epoch ms). sessionStorage is per tab and per origin, so the loop guard survives the redirect it caused;
 * a page where it is blocked keeps an in-memory copy instead. Read at each decision, never cached: another
 * document of this tab (one restored from the back-forward cache) may have added to them.
 */
import type { Logs } from '../blocker/guard-machine.ts';

const KEYS: Readonly<Record<keyof Logs, string>> = { redirects: 'dwell:redirects', undos: 'dwell:undos' };
const memory = new Map<keyof Logs, number[]>();

function load(log: keyof Logs): number[] {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(KEYS[log]) ?? '[]');
    if (Array.isArray(parsed)) return parsed.filter((t): t is number => typeof t === 'number');
  } catch {
    // Storage blocked or the value is not ours: this document's memory still guards it.
  }
  return memory.get(log) ?? [];
}

export function readLogs(): Logs {
  return { redirects: load('redirects'), undos: load('undos') };
}

export function saveLog(log: keyof Logs, times: number[]): void {
  memory.set(log, times);
  try {
    sessionStorage.setItem(KEYS[log], JSON.stringify(times));
  } catch {
    // Storage blocked: the in-memory copy above still guards this document.
  }
}
