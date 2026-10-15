import { afterEach, describe, expect, it, vi } from 'vitest';
import { blockedSiteName, categoryName, hourLabel, hoursLabel, minutesLabel, percentText, relWeek, sitesText, visitsText } from '../src/dashboard/labels.ts';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dashboard labels in English', () => {
  it('names weeks, hours, units, categories, sites and counts', () => {
    expect([relWeek(0), relWeek(1), relWeek(4)]).toEqual(['This week', 'Last week', '4 weeks ago']);
    expect([0, 6, 12, 18].map(hourLabel)).toEqual(['12 AM', '6 AM', '12 PM', '6 PM']);
    expect([minutesLabel(30), hoursLabel(2), percentText(19.6)]).toEqual(['30m', '2h', '20%']);
    expect([categoryName('Shopping'), blockedSiteName('youtube'), blockedSiteName('x')]).toEqual(['Shopping', 'YouTube', 'X']);
    expect([sitesText(1), sitesText(13), visitsText(1), visitsText(60)]).toEqual(['1 site', '13 sites', '1 visit', '60 visits']);
  });
});

describe('dashboard labels when Chrome serves French', () => {
  it('uses 24-hour labels and spaced units', () => {
    vi.stubGlobal('chrome', { i18n: { getMessage: (key: string) => (key === 'lang' ? 'fr' : '') } });
    expect([0, 18].map(hourLabel)).toEqual(['0 h', '18 h']);
    expect([minutesLabel(30), hoursLabel(2), percentText(7)]).toEqual(['30\u00a0min', '2\u00a0h', '7\u00a0%']);
  });
});
