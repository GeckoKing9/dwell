import { describe, expect, it } from 'vitest';
import { dayKey } from '../src/store/schema.ts';
import { navigableWeeks, weekDays, weekIndexFromToday, weekOf } from '../src/stats/weeks.ts';
import { addDays, at } from './stats-helpers.ts';

function keysEndingAt(today: Date, count = 90): string[] {
  return Array.from({ length: count }, (_, i) => dayKey(addDays(today, -i)));
}

describe('weekOf', () => {
  it('starts on the Monday for a midweek date', () => {
    const w = weekOf(at(2026, 10, 14));
    expect([w.start.getFullYear(), w.start.getMonth(), w.start.getDate()]).toEqual([2026, 9, 12]);
    expect([w.end.getMonth(), w.end.getDate()]).toEqual([9, 18]);
  });

  it('keeps a Monday in its own week and puts Sunday at the end of the week', () => {
    expect(weekOf(at(2026, 10, 12)).start.getDate()).toBe(12);
    expect(weekOf(at(2026, 10, 18)).start.getDate()).toBe(12);
    expect(weekOf(at(2026, 10, 19)).start.getDate()).toBe(19);
  });

  it('returns local midnights', () => {
    const w = weekOf(at(2026, 10, 14, 23));
    expect([w.start.getHours(), w.start.getMinutes(), w.end.getHours()]).toEqual([0, 0, 0]);
  });
});

describe('weekDays', () => {
  it('has 7 consecutive local days in every week of two years, DST weeks included', () => {
    for (let i = 0; i < 730; i += 7) {
      const days = weekDays(weekOf(addDays(at(2025, 1, 1), i)));
      expect(days).toHaveLength(7);
      days.forEach((d, k) => {
        expect(d.getDay()).toBe((k + 1) % 7);
        expect(d.getHours()).toBe(0);
      });
    }
  });
});

describe('navigableWeeks', () => {
  it('gives 14 weeks when today is a Monday and 90 days are stored', () => {
    const today = at(2026, 10, 12);
    expect(navigableWeeks(keysEndingAt(today), today)).toHaveLength(14);
  });

  it('gives 13 weeks when today is a Sunday and 90 days are stored', () => {
    const today = at(2026, 10, 18);
    expect(navigableWeeks(keysEndingAt(today), today)).toHaveLength(13);
  });

  it('ends with the current week and starts with the week of the oldest retained day', () => {
    const today = at(2026, 10, 14);
    const keys = keysEndingAt(today);
    const weeks = navigableWeeks(keys, today);
    expect(weeks.at(-1)?.start.getTime()).toBe(weekOf(today).start.getTime());
    expect(weeks[0]?.start.getTime()).toBe(weekOf(addDays(today, -89)).start.getTime());
  });

  it('is ordered oldest to newest with no gaps', () => {
    const today = at(2026, 10, 14);
    const weeks = navigableWeeks(keysEndingAt(today), today);
    for (let i = 1; i < weeks.length; i++) {
      const prev = weeks[i - 1];
      const cur = weeks[i];
      expect(cur?.start.getTime()).toBe(addDays(prev?.start ?? today, 7).setHours(0, 0, 0, 0));
    }
  });

  it('offers only the current week when nothing is stored', () => {
    const today = at(2026, 10, 14);
    expect(navigableWeeks([], today)).toHaveLength(1);
  });

  it('accepts bare dates and ignores keys that are not days', () => {
    const today = at(2026, 10, 14);
    const weeks = navigableWeeks(['2026-10-05', 'settings', 'd:nonsense'], today);
    expect(weeks).toHaveLength(2);
  });
});

describe('weekIndexFromToday', () => {
  it('is 0 for the current week and counts back from there', () => {
    const today = at(2026, 10, 14);
    expect(weekIndexFromToday(weekOf(today), today)).toBe(0);
    expect(weekIndexFromToday(weekOf(addDays(today, -7)), today)).toBe(1);
    expect(weekIndexFromToday(weekOf(addDays(today, -91)), today)).toBe(13);
  });
});
