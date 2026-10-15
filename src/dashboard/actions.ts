/**
 * The dashboard's writes and files. Every write is a message to the worker; export and the event log
 * are read here and handed to `download`, a local save the person started. Each action returns the
 * sentence the page shows next to its control.
 */
import { exportAll } from '../store/export.ts';
import { exportLog } from '../store/log.ts';
import { dateString } from '../store/schema.ts';
import { t } from '../shared/i18n.ts';
import { isHostname } from '../shared/messages.ts';
import { registrableDomain } from '../tracker/grouping.ts';
import { replyFailure } from './data.ts';
import type { DashboardDeps } from './data.ts';

export type HostCheck = { ok: true; host: string } | { ok: false; error: string };

/** What a person types or pastes, reduced to a host: no scheme, path, port or leading `www.`. */
export function normaliseHost(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
}

/** A domain for the never-record list. */
export function checkIgnoreHost(raw: string, list: readonly string[]): HostCheck {
  const host = normaliseHost(raw);
  if (!isHostname(host)) return { ok: false, error: t('badDomain') };
  if (list.includes(host)) return { ok: false, error: t('already', { d: host }) };
  return { ok: true, host };
}

/** A subdomain to count separately; a registrable domain is already a site of its own. */
export function checkSplitHost(raw: string, list: readonly string[]): HostCheck {
  const host = normaliseHost(raw);
  if (!isHostname(host) || registrableDomain(host) === host) return { ok: false, error: t('badSubdomain') };
  if (list.includes(host)) return { ok: false, error: t('already', { d: host }) };
  return { ok: true, host };
}

type FileDeps = Pick<DashboardDeps, 'store' | 'download'>;
type SendDeps = Pick<DashboardDeps, 'send'>;

function kilobytes(text: string): number {
  return Math.max(1, Math.round(new TextEncoder().encode(text).length / 1024));
}

/** Every day key and the settings, in the shape the import accepts. */
export async function exportData(deps: FileDeps, now: Date): Promise<string> {
  const file = await exportAll(deps.store, now);
  const text = JSON.stringify(file);
  const name = `dwell-export-${dateString(now)}.json`;
  deps.download(name, text);
  return t('exported', { f: name, k: kilobytes(text), n: Object.keys(file.days).length });
}

/** The 24-hour event log, a separate file never mixed into the data export. */
export async function exportEventLog(deps: FileDeps, now: Date): Promise<string> {
  const log = await exportLog(deps.store);
  const name = `dwell-events-${dateString(now)}.json`;
  deps.download(name, JSON.stringify(log));
  return t('logExported', { f: name, n: log.entries.length });
}

/** Hands the file's text to the worker, which validates and merges it; the reply's reason is shown on failure. */
export async function importData(deps: SendDeps, name: string, text: string): Promise<string> {
  const reply = await deps.send({ type: 'import', text });
  const failure = replyFailure(reply);
  if (failure !== null) return t('importFailed', { f: name, r: failure });
  const written = (reply as { daysWritten?: unknown }).daysWritten;
  return t('imported', { f: name, n: typeof written === 'number' ? written : 0 });
}

export type DeleteOutcome = { ok: true; undoUntil: number } | { ok: false; error: string };

/** The worker deletes at once and keeps a snapshot until `undoUntil`. */
export async function deleteEverything(deps: SendDeps): Promise<DeleteOutcome> {
  const reply = await deps.send({ type: 'deleteAll' });
  const failure = replyFailure(reply);
  if (failure !== null) return { ok: false, error: t('changeFailed', { r: failure }) };
  const until = (reply as { undoUntil?: unknown }).undoUntil;
  return { ok: true, undoUntil: typeof until === 'number' ? until : 0 };
}

export async function undoDelete(deps: SendDeps): Promise<string> {
  const failure = replyFailure(await deps.send({ type: 'undoDelete' }));
  if (failure === null) return t('restored');
  return failure === 'expired' ? t('undoExpired') : t('changeFailed', { r: failure });
}
