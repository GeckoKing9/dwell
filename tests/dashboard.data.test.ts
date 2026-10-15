import { describe, expect, it } from 'vitest';
import { memoryStore } from '../src/store/adapter.ts';
import { DEFAULT_SETTINGS, SETTINGS_KEY } from '../src/store/schema.ts';
import {
  isRelevantChange,
  knownSites,
  loadDashboardData,
  replyFailure,
  settlePending,
  shownFor,
  weeksOf,
  withPending,
} from '../src/dashboard/data.ts';
import { mergeSeen } from '../src/dashboard/settingsUi.ts';
import { NOW, sampleData, sampleDays } from './support/dashboard.ts';

describe('loading', () => {
  it('reads every day key and the settings, ignoring other keys', async () => {
    const store = memoryStore({ ...sampleDays(), [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, paused: true }, 'log:2026-10-14T10': [], other: 1 });
    const data = await loadDashboardData({ store, now: () => NOW });
    expect(Object.keys(data.days).sort()).toEqual(Object.keys(sampleDays()).sort());
    expect(data.settings.paused).toBe(true);
    expect(data.now).toBe(NOW);
  });

  it('reads defaults from an empty store', async () => {
    const data = await loadDashboardData({ store: memoryStore(), now: () => NOW });
    expect(data.days).toEqual({});
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('re-reads only for settings or day keys in local storage', () => {
    expect(isRelevantChange(['settings'], 'local')).toBe(true);
    expect(isRelevantChange(['x', 'd:2026-10-14'], 'local')).toBe(true);
    expect(isRelevantChange(['log:2026-10-14T10'], 'local')).toBe(false);
    expect(isRelevantChange(['settings'], 'session')).toBe(false);
  });

  it('navigates every week the stored days touch, up to this week', () => {
    expect(weeksOf(sampleData()).map((w) => w.start.getDate())).toEqual([28, 5, 12]);
    expect(weeksOf(sampleData({}))).toHaveLength(1);
  });

  it('lists every site seen or categorised, sorted, for the category editor', () => {
    expect(knownSites(sampleData(sampleDays(), { categories: { 'zzz.example': 'News' } }))).toEqual([
      'github.com',
      'instagram.com',
      'netflix.com',
      'youtube.com',
      'zzz.example',
    ]);
  });
});

describe('pending changes', () => {
  it('shows a partial blockers patch merged over the current switches', () => {
    expect(shownFor(DEFAULT_SETTINGS, { blockers: { youtubeShorts: false } })).toEqual({
      blockers: { ...DEFAULT_SETTINGS.blockers, youtubeShorts: false },
    });
    expect(shownFor(DEFAULT_SETTINGS, { idleThresholdSec: 120, ignore: ['a.com'] })).toEqual({ idleThresholdSec: 120, ignore: ['a.com'] });
  });

  it('lays pending values over the stored settings', () => {
    expect(withPending(DEFAULT_SETTINGS, { paused: true }).paused).toBe(true);
    expect(withPending(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS);
  });

  it('drops a settled key unless a newer change replaced it', () => {
    const first = { ignore: ['a.com'] };
    const newer = { ignore: ['a.com', 'b.com'] };
    expect(settlePending({ ...first, paused: true }, first)).toEqual({ paused: true });
    expect(settlePending(newer, first)).toEqual(newer);
  });

  it('keeps split hosts switched off during the visit next to the stored ones', () => {
    expect(mergeSeen(['mail.google.com'], ['docs.google.com', 'mail.google.com'])).toEqual(['mail.google.com', 'docs.google.com']);
  });
});

describe('worker replies', () => {
  it('reads success, a reason, or a missing reply', () => {
    expect(replyFailure({ ok: true })).toBeNull();
    expect(replyFailure({ ok: false, reason: 'expired' })).toBe('expired');
    expect(replyFailure({ ok: false })).toBe('The background worker refused the change.');
    expect(replyFailure(undefined)).toBe('No reply from the background worker.');
  });
});
