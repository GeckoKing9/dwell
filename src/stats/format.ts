import type { Delta } from './aggregate.ts';
import type { WeekRange } from './weeks.ts';

export type Locale = 'en' | 'fr';

export interface DurationPart {
  value: string;
  unit: string;
}

const NBSP = ' ';

/** Value and unit pairs so the UI can set units smaller than digits. */
export function formatDurationParts(seconds: number, locale: Locale): DurationPart[] {
  const sec = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hUnit = 'h';
  const mUnit = locale === 'fr' ? 'min' : 'm';
  if (sec < 60) return [{ value: '<1', unit: mUnit }];
  const minutes = Math.round(sec / 60);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return [{ value: String(rest), unit: mUnit }];
  if (rest === 0) return [{ value: String(hours), unit: hUnit }];
  return [
    { value: String(hours), unit: hUnit },
    { value: String(rest), unit: mUnit },
  ];
}

/** '<1m', '42m', '1h', '1h 12m' (fr: '<1 min', '42 min', '1 h', '1 h 12 min'). */
export function formatDuration(seconds: number, locale: Locale): string {
  const gap = locale === 'fr' ? ' ' : '';
  return formatDurationParts(seconds, locale)
    .map((p) => `${p.value}${gap}${p.unit}`)
    .join(' ');
}

/** Swap breaking spaces for no-break spaces so a duration never splits across lines. */
export function noBreak(text: string): string {
  return text.replaceAll(' ', NBSP);
}

/** The week-over-week sentence. Plain facts, base named, no judgement. */
export function formatDeltaSentence(delta: Delta, previousAverage: number | null, locale: Locale): string {
  const prev = previousAverage === null ? '' : ` (${formatDuration(previousAverage, locale)})`;
  if (locale === 'fr') {
    const pct = `${delta.percent}${NBSP}%`;
    switch (delta.kind) {
      case 'none':
        return 'Aucune donnée pour la semaine précédente à comparer.';
      case 'same':
        return `La moyenne quotidienne est à peu près la même que la semaine précédente${prev}.`;
      case 'less':
        return `La moyenne quotidienne est inférieure de ${pct} à celle de la semaine précédente${prev}.`;
      case 'more':
        return `La moyenne quotidienne est supérieure de ${pct} à celle de la semaine précédente${prev}.`;
    }
  }
  switch (delta.kind) {
    case 'none':
      return 'No data for the week before to compare with.';
    case 'same':
      return `Daily average is about the same as the week before${prev}.`;
    case 'less':
      return `Daily average is ${delta.percent}% lower than the week before${prev}.`;
    case 'more':
      return `Daily average is ${delta.percent}% higher than the week before${prev}.`;
  }
}

function localeTag(locale: Locale): string {
  return locale === 'fr' ? 'fr-CA' : 'en-US';
}

/** 'Oct 12 – 18, 2026' for a week. */
export function formatDayRange(week: WeekRange, locale: Locale): string {
  const fmt = new Intl.DateTimeFormat(localeTag(locale), { month: 'short', day: 'numeric', year: 'numeric' });
  return fmt.formatRange(week.start, week.end);
}

function hour12(hour: number): number {
  return hour % 12 === 0 ? 12 : hour % 12;
}

/** The hour as a range: '9 – 10 PM', '11 AM – 12 PM', fr '21 h – 22 h'. */
export function formatHourRange(hour: number, locale: Locale): string {
  const next = (hour + 1) % 24;
  if (locale === 'fr') return `${hour} h – ${next} h`;
  const a = hour12(hour);
  const b = hour12(next);
  const sa = hour < 12 ? 'AM' : 'PM';
  const sb = next < 12 ? 'AM' : 'PM';
  return sa === sb ? `${a} – ${b} ${sb}` : `${a} ${sa} – ${b} ${sb}`;
}
