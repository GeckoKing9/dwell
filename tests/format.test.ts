import { describe, expect, it } from 'vitest';
import { formatDayRange, formatDeltaSentence, formatDuration, formatDurationParts, formatHourRange } from '../src/stats/format.ts';
import { weekOf } from '../src/stats/weeks.ts';
import { at } from './stats-helpers.ts';

describe('formatDuration', () => {
  it('formats English durations', () => {
    expect(formatDuration(0, 'en')).toBe('<1m');
    expect(formatDuration(59, 'en')).toBe('<1m');
    expect(formatDuration(60, 'en')).toBe('1m');
    expect(formatDuration(42 * 60, 'en')).toBe('42m');
    expect(formatDuration(3600, 'en')).toBe('1h');
    expect(formatDuration(4320, 'en')).toBe('1h 12m');
    expect(formatDuration(3599, 'en')).toBe('1h');
    expect(formatDuration(12720, 'en')).toBe('3h 32m');
  });

  it('formats French durations', () => {
    expect(formatDuration(59, 'fr')).toBe('<1 min');
    expect(formatDuration(42 * 60, 'fr')).toBe('42 min');
    expect(formatDuration(3600, 'fr')).toBe('1 h');
    expect(formatDuration(4320, 'fr')).toBe('1 h 12 min');
  });

  it('treats negative and non-finite input as zero', () => {
    expect(formatDuration(-5, 'en')).toBe('<1m');
    expect(formatDuration(Number.NaN, 'en')).toBe('<1m');
    expect(formatDuration(Number.POSITIVE_INFINITY, 'fr')).toBe('<1 min');
  });
});

describe('formatDurationParts', () => {
  it('splits value and unit for the big-number UI', () => {
    expect(formatDurationParts(4320, 'en')).toEqual([{ value: '1', unit: 'h' }, { value: '12', unit: 'm' }]);
    expect(formatDurationParts(3600, 'fr')).toEqual([{ value: '1', unit: 'h' }]);
    expect(formatDurationParts(30, 'fr')).toEqual([{ value: '<1', unit: 'min' }]);
    expect(formatDurationParts(42 * 60, 'en')).toEqual([{ value: '42', unit: 'm' }]);
  });
});

describe('formatDeltaSentence', () => {
  it('names the comparison base in plain words', () => {
    expect(formatDeltaSentence({ kind: 'less', percent: 12 }, 12720, 'en')).toBe('Daily average is 12% lower than the week before (3h 32m).');
    expect(formatDeltaSentence({ kind: 'more', percent: 19 }, 12720, 'en')).toBe('Daily average is 19% higher than the week before (3h 32m).');
    expect(formatDeltaSentence({ kind: 'same', percent: 1 }, 12720, 'en')).toBe('Daily average is about the same as the week before (3h 32m).');
    expect(formatDeltaSentence({ kind: 'none', percent: 0 }, null, 'en')).toBe('No data for the week before to compare with.');
  });

  it('has French sentences', () => {
    const more = formatDeltaSentence({ kind: 'more', percent: 19 }, 12720, 'fr');
    expect(more).toContain('19 %');
    expect(more).toContain('3 h 32 min');
    expect(formatDeltaSentence({ kind: 'none', percent: 0 }, null, 'fr')).toBe('Aucune donnée pour la semaine précédente à comparer.');
  });

  it('never prints NaN or a judgement', () => {
    for (const kind of ['none', 'same', 'less', 'more'] as const) {
      const s = formatDeltaSentence({ kind, percent: 5 }, null, 'en');
      expect(s).not.toMatch(/NaN|Infinity|undefined/);
    }
  });
});

describe('formatHourRange', () => {
  it('formats English ranges', () => {
    expect(formatHourRange(21, 'en')).toBe('9 – 10 PM');
    expect(formatHourRange(11, 'en')).toBe('11 AM – 12 PM');
    expect(formatHourRange(0, 'en')).toBe('12 – 1 AM');
    expect(formatHourRange(23, 'en')).toBe('11 PM – 12 AM');
  });

  it('formats French ranges', () => {
    expect(formatHourRange(21, 'fr')).toBe('21 h – 22 h');
    expect(formatHourRange(23, 'fr')).toBe('23 h – 0 h');
  });
});

describe('formatDayRange', () => {
  it('formats a Monday to Sunday week', () => {
    const w = weekOf(at(2026, 10, 14));
    expect(formatDayRange(w, 'en')).toMatch(/Oct\w* 12/);
    expect(formatDayRange(w, 'en')).toMatch(/18/);
    expect(formatDayRange(w, 'fr')).toMatch(/12/);
  });
});
