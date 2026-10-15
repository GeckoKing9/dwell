import { describe, expect, it, vi } from 'vitest';
import manifest from '../manifest.json';
import en from '../_locales/en/messages.json';
import { PERMISSIONS, SITE_ACCESS } from '../src/dashboard/components/Privacy.tsx';
import { all, byClass, byId, everything, text } from './support/vnode.ts';
import type { El, Tree } from './support/vnode.ts';
import { sampleData, sampleDays } from './support/dashboard.ts';
import { handlers, renderDashboard } from './support/dashboardView.ts';

function call(el: El | undefined, prop: string, arg?: unknown): void {
  const fn = el?.props[prop];
  if (typeof fn !== 'function') throw new Error(`no ${prop}`);
  (fn as (a: unknown) => void)(arg);
}

function el(tree: Tree[], id: string): El {
  const found = byId(tree, id);
  if (!found) throw new Error(`no #${id}`);
  return found;
}

describe('settings', () => {
  const on = handlers();
  const data = sampleData(sampleDays(), { overrides: ['mail.google.com'], ignore: ['news.example'], categories: { 'github.com': 'Other' } });
  const tree = renderDashboard({ view: 'settings' }, data, { on, ui: { seenSplits: ['mail.google.com', 'docs.google.com'] } });

  it('groups tracking, blockers, sites and data, with Settings current', () => {
    expect(all(tree, (e) => e.type === 'h2').map((h) => text([h]))).toEqual(['Tracking', 'Blockers', 'Sites', 'Appearance', 'Data']);
    expect(el(tree, 'nav-settings').props['aria-current']).toBe('page');
    const index = all(byClass(tree, 'set-index'), (e) => e.type === 'a');
    const preventDefault = vi.fn();
    call(index[4], 'onClick', { preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(on.settings.jump).toHaveBeenCalledWith('set-data');
  });

  it('offers the four idle thresholds as one segmented choice and sends only a real change', () => {
    const radios = all([el(tree, 'row-idle')], (e) => e.props.role === 'radio');
    expect(radios.map((r) => [text([r]), r.props['aria-checked']])).toEqual([
      ['30 s', 'false'],
      ['60 s', 'true'],
      ['120 s', 'false'],
      ['300 s', 'false'],
    ]);
    call(el(tree, 'idle-120'), 'onClick');
    call(el(tree, 'idle-60'), 'onClick');
    expect(on.settings.change).toHaveBeenCalledTimes(1);
    expect(on.settings.change).toHaveBeenCalledWith({ idleThresholdSec: 120 });
  });

  it('offers System, Light and Dark as one segmented choice and sends only a real change', () => {
    const row = el(tree, 'row-theme');
    const radios = all([row], (e) => e.props.role === 'radio');
    expect(radios.map((r) => [text([r]), r.props['aria-checked']])).toEqual([
      ['System', 'true'],
      ['Light', 'false'],
      ['Dark', 'false'],
    ]);
    call(el(tree, 'theme-system'), 'onClick');
    expect(on.settings.change).not.toHaveBeenCalledWith({ theme: 'system' });
    call(el(tree, 'theme-dark'), 'onClick');
    expect(on.settings.change).toHaveBeenLastCalledWith({ theme: 'dark' });
  });

  it('flips media, pause, each blocker and the event log with one tap', () => {
    call(el(tree, 'media-switch'), 'onClick');
    call(el(tree, 'pause-switch'), 'onClick');
    call(el(tree, 'blocker-instagramExplore'), 'onClick');
    call(el(tree, 'blocker-youtubeShorts'), 'onClick');
    call(el(tree, 'eventlog-switch'), 'onClick');
    expect(vi.mocked(on.settings.change).mock.calls.slice(-4)).toEqual([
      [{ mediaOverride: false }],
      [{ blockers: { instagramExplore: true } }],
      [{ blockers: { youtubeShorts: false } }],
      [{ eventLog: true }],
    ]);
    expect(on.settings.pause).toHaveBeenCalledWith(true);
    expect(el(tree, 'blocker-instagramExplore').props['aria-checked']).toBe('false');
    expect(el(tree, 'blocker-instagramReels').props['aria-labelledby']).toBe('row-instagramReels-title');
  });

  it('lists split subdomains with their state and a switch to count them with their site again', () => {
    expect(byClass(tree, 'ovr-row').map((r) => text([r]))).toEqual(['mail.google.com · Counted separately', 'docs.google.com · Counted with google.com']);
    call(el(tree, 'split-mail_google_com'), 'onClick');
    call(el(tree, 'split-docs_google_com'), 'onClick');
    expect(vi.mocked(on.settings.change).mock.calls.slice(-2)).toEqual([[{ overrides: [] }], [{ overrides: ['mail.google.com', 'docs.google.com'] }]]);
  });

  it('gives every settings control a stable id, with host-based ids made selector-safe', () => {
    const controls = all(tree, (e) => e.type === 'button' || e.type === 'select' || e.type === 'input');
    expect(controls.length).toBeGreaterThan(20);
    expect(controls.filter((e) => typeof e.props.id !== 'string' || e.props.id === '').map((e) => text([e]))).toEqual([]);
    const ids = controls.map((e) => String(e.props.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(el(tree, 'ignore-remove-news_example').type).toBe('button');
  });

  it('adds and removes never-record domains through the field and its chips', () => {
    expect(text(byClass(tree, 'chip-x'))).toBe('news.example\u00d7');
    const remove = all(byClass(tree, 'chip-x'), (e) => e.type === 'button')[0];
    expect(remove?.props['aria-label']).toBe('Remove news.example');
    call(remove, 'onClick');
    expect(on.settings.removeIgnore).toHaveBeenCalledWith('news.example');
    call(el(tree, 'ignore-input'), 'onInput', { currentTarget: { value: 'x.com' } });
    expect(on.settings.draft).toHaveBeenCalledWith('ignore', 'x.com');
    call(el(tree, 'ignore-input'), 'onKeyDown', { key: 'Enter' });
    call(el(tree, 'ignore-input'), 'onKeyDown', { key: 'a' });
    call(el(tree, 'split-add'), 'onClick');
    expect(vi.mocked(on.settings.add).mock.calls).toEqual([['ignore'], ['split']]);
  });

  it('shows a field’s validation error beside it', () => {
    const withError = renderDashboard({ view: 'settings' }, data, { ui: { errors: { ignore: 'Enter a domain such as example.com.', split: '' } } });
    expect(text([el(withError, 'ignore-error')])).toBe('Enter a domain such as example.com.');
    expect(el(withError, 'ignore-error').props.role).toBe('alert');
    expect(el(withError, 'ignore-input').props['aria-invalid']).toBe('true');
    expect(byId(withError, 'split-error')).toBeUndefined();
  });

  it('edits the category of every known site', () => {
    const select = el(tree, 'cat-github_com');
    expect(select.props.value).toBe('Other');
    expect(el(tree, 'cat-youtube_com').props.value).toBe('Video');
    expect(all([select], (e) => e.type === 'option').map((o) => text([o]))).toEqual(['Social', 'Video', 'Work', 'Shopping', 'News', 'Other']);
    call(select, 'onChange', { currentTarget: { value: 'Work' } });
    call(select, 'onChange', { currentTarget: { value: 'Nonsense' } });
    expect(vi.mocked(on.settings.change).mock.calls.at(-1)).toEqual([{ categories: { 'github.com': 'Work' } }]);
  });

  it('explains the empty category editor before anything is recorded', () => {
    const empty = renderDashboard({ view: 'settings' }, sampleData({}));
    expect(text([el(empty, 'cats-empty')])).toBe('Sites appear here once Dwell has recorded them.');
    expect(byClass(empty, 'cat-editor')).toHaveLength(0);
  });

  it('exports, imports and deletes, with the event-log export only while the log is on', () => {
    expect(text(byClass(tree, 'chip-lg'))).toBe('90 days');
    expect(byId(tree, 'export-log')).toBeUndefined();
    call(el(tree, 'export-json'), 'onClick');
    call(el(tree, 'delete-all'), 'onClick');
    expect(on.settings.exportJson).toHaveBeenCalled();
    expect(on.settings.deleteAll).toHaveBeenCalled();
    const file = { name: 'a.json' };
    const input = { files: [file], value: 'C:\\a.json' };
    call(el(tree, 'import-file'), 'onChange', { currentTarget: input });
    expect(on.settings.importFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
    call(el(tree, 'import-file'), 'onChange', { currentTarget: { files: [], value: '' } });
    expect(on.settings.importFile).toHaveBeenCalledTimes(1);
    const click = vi.fn();
    on.settings.fileRef.current = { click } as unknown as HTMLInputElement;
    call(el(tree, 'import-choose'), 'onClick');
    expect(click).toHaveBeenCalled();

    const logging = renderDashboard({ view: 'settings' }, sampleData(sampleDays(), { eventLog: true }), { on });
    call(el(logging, 'export-log'), 'onClick');
    expect(on.settings.exportLog).toHaveBeenCalled();
  });

  it('shows each action’s notice and keeps delete disabled while undo is offered', () => {
    const notices = { export: 'Prepared a.json (1 KB, 2 days).', import: 'Read b.json: 2 days added or updated.', delete: 'History restored.', settings: 'Dwell couldn’t apply that change. No.' };
    const shown = renderDashboard({ view: 'settings' }, data, { ui: { notices, undoOpen: true } });
    expect(byClass(shown, 'notice').map((n) => text([n]))).toEqual([notices.settings, notices.export, notices.import, notices.delete]);
    expect(el(shown, 'delete-all').props.disabled).toBe(true);
    expect(everything(shown)).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('undo toast', () => {
  it('stays up on any view while the worker holds the snapshot, and undoes in one tap', () => {
    const on = handlers();
    for (const route of [{ view: 'week', back: 0 } as const, { view: 'privacy' } as const]) {
      const tree = renderDashboard(route, sampleData({}), { on, ui: { undoOpen: true } });
      expect(text([el(tree, 'undo-toast')])).toBe('All history deleted.Undo');
      call(el(tree, 'undo-delete'), 'onClick');
    }
    expect(on.onUndo).toHaveBeenCalledTimes(2);
    expect(byId(renderDashboard({ view: 'week', back: 0 }, sampleData()), 'undo-toast')).toBeUndefined();
  });
});

describe('privacy panel', () => {
  const tree = renderDashboard({ view: 'privacy' }, sampleData());
  const prose = text(tree);

  it('never claims that no network access is possible', () => {
    expect(prose.toLowerCase()).not.toContain('no network access is possible');
    const catalog = Object.values(en as Record<string, { message: string }>).map((m) => m.message.toLowerCase());
    expect(catalog.filter((m) => m.includes('no network access is possible'))).toEqual([]);
  });

  it('states what the tests check, in auditable terms', () => {
    expect(prose).toContain('configured to refuse network requests');
    expect(prose).toContain("default-src 'none'");
    expect(prose).toContain('Its scripts run only on Instagram, YouTube and Facebook and send nothing off the device.');
    expect(prose).toContain('Reels and Shorts redirects stay within those sites.');
    expect(prose).toContain('auditable');
    expect(prose.toLowerCase()).not.toContain('provable');
    expect(el(tree, 'nav-privacy').props['aria-current']).toBe('page');
  });

  it('lists exactly the manifest’s permissions and site access', () => {
    const listed = all([el(tree, 'permissions')], (e) => e.type === 'code').map((c) => text([c]));
    expect([...listed].sort()).toEqual([...manifest.permissions, ...manifest.host_permissions].sort());
    expect(new Set(listed).size).toBe(listed.length);
    expect(PERMISSIONS.map(([name]) => name).sort()).toEqual([...manifest.permissions].sort());
    expect(SITE_ACCESS).toEqual(manifest.host_permissions);
  });

  it('lists what is stored and what never is', () => {
    const lists = all(byClass(tree, 'kept'), (e) => e.type === 'ul').map((ul) => ul.children.length);
    expect(lists).toEqual([6, 5]);
    expect(prose).toContain('Full addresses or paths');
  });
});
