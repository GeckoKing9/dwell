import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeHandlers } from '../src/dashboard/handlers.ts';
import type { PageDeps, Pending } from '../src/dashboard/data.ts';
import { EMPTY_UI } from '../src/dashboard/settingsUi.ts';
import type { SettingsUi } from '../src/dashboard/settingsUi.ts';
import { memoryStore } from '../src/store/adapter.ts';
import { DEFAULT_SETTINGS } from '../src/store/schema.ts';
import type { Settings } from '../src/store/schema.ts';
import { NOW, sampleDays } from './support/dashboard.ts';

type Update<T> = (next: T | ((previous: T) => T)) => void;

function cell<T>(initial: T): { value: T; set: Update<T> } {
  const box = {
    value: initial,
    set: ((next) => {
      box.value = typeof next === 'function' ? (next as (p: T) => T)(box.value) : next;
    }) as Update<T>,
  };
  return box;
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function setup(settings: Partial<Settings> = {}, ui: Partial<SettingsUi> = {}, reply: unknown = { ok: true }) {
  const deps = {
    store: memoryStore(sampleDays()),
    send: vi.fn().mockResolvedValue(reply),
    onChange: vi.fn(),
    now: () => NOW,
    download: vi.fn(),
    hash: { get: vi.fn(() => ''), set: vi.fn(), onChange: vi.fn() },
    readFile: vi.fn().mockResolvedValue('{"format":"dwell-export"}'),
    observeWidth: vi.fn(),
    scrollTo: vi.fn(),
  } satisfies PageDeps;
  const state = {
    ui: cell<SettingsUi>({ ...EMPTY_UI, ...ui }),
    pending: cell<Pending>({}),
    showAll: cell(false),
    undoUntil: cell<number | null>(null),
  };
  const refresh = vi.fn().mockResolvedValue(undefined);
  const handlers = makeHandlers({
    deps,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    ui: state.ui.value,
    setUi: state.ui.set,
    setPending: state.pending.set,
    setShowAll: state.showAll.set,
    setUndoUntil: state.undoUntil.set,
    refresh,
    fileRef: { current: null },
  });
  return { deps, state, refresh, handlers };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('navigation handlers', () => {
  it('route through the location hash', () => {
    const { deps, handlers } = setup();
    handlers.onWeek(2);
    handlers.onDay('2026-10-13');
    handlers.onWeek(0);
    expect(deps.hash.set.mock.calls).toEqual([['#week/2'], ['#day/2026-10-13'], ['#week']]);
  });

  it('toggle the full most-used list and scroll to a settings group', () => {
    const { deps, state, handlers } = setup();
    handlers.onToggleAll();
    expect(state.showAll.value).toBe(true);
    handlers.settings.jump('set-data');
    expect(deps.scrollTo).toHaveBeenCalledWith('set-data');
  });
});

describe('settings writes', () => {
  it('send only the changed keys, show them at once, then settle after reading back', async () => {
    const { deps, state, refresh, handlers } = setup();
    handlers.settings.change({ idleThresholdSec: 120 });
    expect(deps.send).toHaveBeenCalledWith({ type: 'settings', patch: { idleThresholdSec: 120 } });
    expect(state.pending.value).toEqual({ idleThresholdSec: 120 });
    await flush();
    expect(refresh).toHaveBeenCalled();
    expect(state.pending.value).toEqual({});
  });

  it('send pause and resume as their own message', () => {
    const { deps, handlers } = setup({ paused: true });
    handlers.onResume();
    handlers.settings.pause(true);
    expect(deps.send.mock.calls).toEqual([[{ type: 'pause', paused: false }], [{ type: 'pause', paused: true }]]);
  });

  it('show the worker’s reason when it refuses a change', async () => {
    const { state, handlers } = setup({}, {}, { ok: false, reason: 'Settings must be an object.' });
    handlers.settings.change({ mediaOverride: false });
    await flush();
    expect(state.ui.value.notices.settings).toBe('Dwell couldn’t apply that change. Settings must be an object.');
  });

  it('report a message that could not be delivered', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, state, handlers } = setup();
    deps.send.mockRejectedValueOnce(new Error('Receiving end does not exist.'));
    handlers.settings.change({ eventLog: true });
    await flush();
    expect(state.ui.value.notices.settings).toBe('Dwell couldn’t apply that change. Receiving end does not exist.');
    expect(quiet).toHaveBeenCalled();
    expect(state.pending.value).toEqual({});
  });
});

describe('list fields', () => {
  it('add a typed domain to the never-record list and clear the field', () => {
    const { deps, state, handlers } = setup({ ignore: ['a.com'] }, { drafts: { ignore: 'https://www.Example.com/x', split: '' } });
    handlers.settings.add('ignore');
    expect(deps.send).toHaveBeenCalledWith({ type: 'settings', patch: { ignore: ['a.com', 'example.com'] } });
    expect(state.ui.value.drafts.ignore).toBe('');
    expect(state.ui.value.errors.ignore).toBe('');
  });

  it('keep a bad entry in the field with an error and send nothing', () => {
    const { deps, state, handlers } = setup({}, { drafts: { ignore: 'not a domain', split: 'google.com' } });
    handlers.settings.add('ignore');
    handlers.settings.add('split');
    expect(deps.send).not.toHaveBeenCalled();
    expect(state.ui.value.drafts).toEqual({ ignore: 'not a domain', split: 'google.com' });
    expect(state.ui.value.errors).toEqual({ ignore: 'Enter a domain such as example.com.', split: 'Enter a subdomain such as mail.google.com.' });
    handlers.settings.draft('ignore', 'nop');
    expect(state.ui.value.errors.ignore).toBe('');
  });

  it('split a subdomain out and keep it listed after it is switched back', () => {
    const { deps, state, handlers } = setup({ overrides: ['docs.google.com'] }, { drafts: { ignore: '', split: 'mail.google.com' } });
    handlers.settings.add('split');
    expect(deps.send).toHaveBeenCalledWith({ type: 'settings', patch: { overrides: ['docs.google.com', 'mail.google.com'] } });
    expect(state.ui.value.seenSplits).toEqual(['docs.google.com', 'mail.google.com']);
    handlers.settings.change({ overrides: [] });
    expect(state.ui.value.seenSplits).toEqual(['docs.google.com', 'mail.google.com']);
  });

  it('remove a domain from the never-record list', () => {
    const { deps, handlers } = setup({ ignore: ['a.com', 'b.com'] });
    handlers.settings.removeIgnore('a.com');
    expect(deps.send).toHaveBeenCalledWith({ type: 'settings', patch: { ignore: ['b.com'] } });
  });
});

describe('data actions', () => {
  it('export the data and the event log with a notice each', async () => {
    const { deps, state, handlers } = setup();
    handlers.settings.exportJson();
    handlers.settings.exportLog();
    await flush();
    expect(deps.download.mock.calls.map((c) => String(c[0])).sort()).toEqual(['dwell-events-2026-10-14.json', 'dwell-export-2026-10-14.json']);
    expect(state.ui.value.notices.export).toMatch(/^Prepared dwell-export/);
    expect(state.ui.value.notices.log).toMatch(/^Prepared dwell-events/);
  });

  it('import a chosen file through the worker', async () => {
    const { deps, state, refresh, handlers } = setup({}, {}, { ok: true, skipped: 0, daysWritten: 2, settingsWritten: false });
    handlers.settings.importFile(new File(['{}'], 'back.json'));
    await flush();
    expect(deps.send).toHaveBeenCalledWith({ type: 'import', text: '{"format":"dwell-export"}' });
    expect(state.ui.value.notices.import).toBe('Read back.json: 2 days added or updated.');
    expect(refresh).toHaveBeenCalled();
  });

  it('report a file that cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { deps, state, handlers } = setup();
    deps.readFile.mockRejectedValueOnce(new Error('The file could not be read.'));
    handlers.settings.importFile(new File([''], 'x.json'));
    await flush();
    expect(state.ui.value.notices.import).toBe('Dwell couldn’t apply that change. The file could not be read.');
  });

  it('delete all, open the undo toast until the worker’s deadline, and undo', async () => {
    const { deps, state, handlers } = setup({}, {}, { ok: true, undoUntil: 99 });
    handlers.settings.deleteAll();
    await flush();
    expect(deps.send).toHaveBeenCalledWith({ type: 'deleteAll' });
    expect(state.undoUntil.value).toBe(99);
    deps.send.mockResolvedValueOnce({ ok: true });
    handlers.onUndo();
    await flush();
    expect(deps.send).toHaveBeenLastCalledWith({ type: 'undoDelete' });
    expect(state.undoUntil.value).toBeNull();
    expect(state.ui.value.notices.delete).toBe('History restored.');
  });

  it('keep the toast closed when the worker refuses to delete', async () => {
    const { state, handlers } = setup({}, {}, { ok: false, reason: 'No.' });
    handlers.settings.deleteAll();
    await flush();
    expect(state.undoUntil.value).toBeNull();
    expect(state.ui.value.notices.delete).toBe('Dwell couldn’t apply that change. No.');
  });
});
