import { describe, expect, it, vi } from 'vitest';
import { createOpenDay, type OpenDayApi } from '../src/popup/openDay.ts';

const DASH = `chrome-extension://${'a'.repeat(32)}/src/dashboard/index.html`;

function api(tabs: Awaited<ReturnType<OpenDayApi['query']>>, failUpdate = false) {
  return {
    query: vi.fn(async () => tabs),
    update: vi.fn(async () => {
      if (failUpdate) throw new Error('No tab with id: 7.');
    }),
    create: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    fallback: vi.fn(async () => undefined),
  } satisfies OpenDayApi;
}

describe('opening a day from the popup', () => {
  it('shows the day in the open dashboard tab and brings its window forward', async () => {
    const chrome = api([{ id: 3, windowId: 1, url: 'https://example.com/' }, { id: 7, windowId: 2, url: `${DASH}#week` }]);
    await createOpenDay(chrome, DASH)('2026-10-22');
    expect(chrome.update).toHaveBeenCalledWith(7, { url: `${DASH}#day/2026-10-22`, active: true });
    expect(chrome.focus).toHaveBeenCalledWith(2);
    expect(chrome.create).not.toHaveBeenCalled();
  });

  it('finds a dashboard tab that is still loading by its pending address', async () => {
    const chrome = api([{ id: 7, windowId: 2, url: '', pendingUrl: DASH }]);
    await createOpenDay(chrome, DASH)('2026-10-22');
    expect(chrome.update).toHaveBeenCalledTimes(1);
  });

  it('opens a new tab when none is open, or when the open one closed in between', async () => {
    const none = api([]);
    await createOpenDay(none, DASH)('2026-10-22');
    expect(none.create).toHaveBeenCalledWith({ url: `${DASH}#day/2026-10-22` });
    const closed = api([{ id: 7, windowId: 2, url: DASH }], true);
    await createOpenDay(closed, DASH)('2026-10-22');
    expect(closed.create).toHaveBeenCalledWith({ url: `${DASH}#day/2026-10-22` });
    expect(closed.focus).not.toHaveBeenCalled();
  });

  it('opens one tab for a double click', async () => {
    const chrome = api([]);
    const open = createOpenDay(chrome, DASH);
    await Promise.all([open('2026-10-22'), open('2026-10-22')]);
    expect(chrome.create).toHaveBeenCalledTimes(1);
    await open('2026-10-23');
    expect(chrome.create).toHaveBeenCalledTimes(2);
  });

  it('falls back to the dashboard itself for a date that is not one', async () => {
    const chrome = api([]);
    await createOpenDay(chrome, DASH)('22/10/2026');
    expect(chrome.fallback).toHaveBeenCalled();
    expect(chrome.create).not.toHaveBeenCalled();
  });
});
