import { describe, expect, it, vi } from 'vitest';
import {
  checkIgnoreHost,
  checkSplitHost,
  deleteEverything,
  exportData,
  exportEventLog,
  importData,
  normaliseHost,
  undoDelete,
} from '../src/dashboard/actions.ts';
import { memoryStore } from '../src/store/adapter.ts';
import { importText } from '../src/store/export.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/store/schema.ts';
import { NOW, sampleDays } from './support/dashboard.ts';

describe('typed domains', () => {
  it('reduces a pasted address to its host', () => {
    expect(normaliseHost('  https://www.Example.com/path?q=1 ')).toBe('example.com');
    expect(normaliseHost('mail.google.com:443')).toBe('mail.google.com');
    expect(normaliseHost('news.example.')).toBe('news.example');
  });

  it('accepts a domain for the never-record list once', () => {
    expect(checkIgnoreHost('Example.com', [])).toEqual({ ok: true, host: 'example.com' });
    expect(checkIgnoreHost('example.com', ['example.com'])).toEqual({ ok: false, error: 'example.com is already on the list.' });
    for (const bad of ['', 'not a domain', '__proto__', 'a..b']) {
      expect(checkIgnoreHost(bad, []), bad).toEqual({ ok: false, error: 'Enter a domain such as example.com.' });
    }
  });

  it('accepts only a subdomain for grouping, since a registrable domain is already its own site', () => {
    expect(checkSplitHost('mail.google.com', [])).toEqual({ ok: true, host: 'mail.google.com' });
    expect(checkSplitHost('a.example.co.uk', [])).toEqual({ ok: true, host: 'a.example.co.uk' });
    expect(checkSplitHost('google.com', [])).toEqual({ ok: false, error: 'Enter a subdomain such as mail.google.com.' });
    expect(checkSplitHost('example.co.uk', []).ok).toBe(false);
    expect(checkSplitHost('mail.google.com', ['mail.google.com']).ok).toBe(false);
  });
});

describe('export and import', () => {
  it('downloads every day and the settings as a file its own import accepts', async () => {
    const store = memoryStore({ ...sampleDays(), [SETTINGS_KEY]: DEFAULT_SETTINGS });
    const download = vi.fn();
    const notice = await exportData({ store, download }, NOW);
    expect(download).toHaveBeenCalledTimes(1);
    const [name, text] = download.mock.calls[0] as [string, string];
    expect(name).toBe('dwell-export-2026-10-14.json');
    expect(notice).toMatch(/^Prepared dwell-export-2026-10-14\.json \(\d+ KB, 9 days\)\.$/);
    const fresh = memoryStore();
    const outcome = await importText(fresh, text, NOW);
    expect(outcome.ok && outcome.daysWritten).toBe(9);
  });

  it('downloads the event log as a separate file', async () => {
    const download = vi.fn();
    const notice = await exportEventLog({ store: memoryStore(), download }, NOW);
    const [name, text] = download.mock.calls[0] as [string, string];
    expect(name).toBe('dwell-events-2026-10-14.json');
    expect((JSON.parse(text) as { entries: unknown[] }).entries).toEqual([]);
    expect(notice).toBe('Prepared dwell-events-2026-10-14.json (0 events).');
  });

  it('hands the file text to the worker and reports what it wrote, or why not', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, skipped: 0, daysWritten: 3, settingsWritten: true });
    expect(await importData({ send }, 'a.json', '{}')).toBe('Read a.json: 3 days added or updated.');
    expect(send).toHaveBeenCalledWith({ type: 'import', text: '{}' });
    send.mockResolvedValueOnce({ ok: false, code: 'bad-json', reason: 'The file is not valid JSON.' });
    expect(await importData({ send }, 'b.json', 'x')).toBe('b.json wasn’t imported. The file is not valid JSON.');
    send.mockResolvedValueOnce({ ok: true });
    expect(await importData({ send }, 'c.json', '{}')).toBe('Read c.json: 0 days added or updated.');
  });
});

describe('delete all and undo', () => {
  it('returns the undo deadline the worker holds the snapshot until', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true, undoUntil: 1234 });
    expect(await deleteEverything({ send })).toEqual({ ok: true, undoUntil: 1234 });
    expect(send).toHaveBeenCalledWith({ type: 'deleteAll' });
    send.mockResolvedValueOnce({ ok: false, reason: 'Dwell could not complete this change.' });
    expect(await deleteEverything({ send })).toEqual({ ok: false, error: 'Dwell couldn’t apply that change. Dwell could not complete this change.' });
    send.mockResolvedValueOnce({ ok: true });
    expect(await deleteEverything({ send })).toEqual({ ok: true, undoUntil: 0 });
  });

  it('says whether the history came back', async () => {
    const send = vi.fn().mockResolvedValueOnce({ ok: true });
    expect(await undoDelete({ send })).toBe('History restored.');
    expect(send).toHaveBeenCalledWith({ type: 'undoDelete' });
    send.mockResolvedValueOnce({ ok: false, reason: 'expired' });
    expect(await undoDelete({ send })).toBe('The undo window had passed, so the history stays deleted.');
    send.mockResolvedValueOnce({ ok: false, reason: 'Nope.' });
    expect(await undoDelete({ send })).toBe('Dwell couldn’t apply that change. Nope.');
  });
});
