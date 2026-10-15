/** Dashboard wording that depends on the catalog language: dates, hours, week labels. */
import { dateLocale, t, uiLang } from '../shared/i18n.ts';
import { formatDayRange, formatHourRange } from '../stats/format.ts';
import type { WeekRange } from '../stats/weeks.ts';
import type { BlockedSite, Category } from '../store/schema.ts';
import type { MessageKey } from '../shared/i18n.ts';

export function fmtDate(date: Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(dateLocale(), options).format(date);
}

/** 'Oct 12 – 18, 2026'. */
export function weekRangeText(week: WeekRange): string {
  return formatDayRange(week, uiLang());
}

/** 'This week', 'Last week', '3 weeks ago'. */
export function relWeek(back: number): string {
  if (back === 0) return t('thisWeek');
  if (back === 1) return t('lastWeek');
  return t('weeksAgo', { n: back });
}

/** Axis label for the start of an hour: '12 AM', '6 PM'; fr '18 h'. */
export function hourLabel(hour: number): string {
  if (uiLang() === 'fr') return `${hour} h`;
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** '9 – 10 PM'. */
export function hourRangeText(hour: number): string {
  return formatHourRange(hour, uiLang());
}

/** Minute axis label: '30m', fr '30 min'. */
export function minutesLabel(minutes: number): string {
  return uiLang() === 'fr' ? `${minutes}\u00a0min` : `${minutes}m`;
}

/** Hour axis label: '2h', fr '2 h'. */
export function hoursLabel(hours: number): string {
  return uiLang() === 'fr' ? `${hours}\u00a0h` : `${hours}h`;
}

export function percentText(value: number): string {
  return `${Math.round(value)}${uiLang() === 'fr' ? '\u00a0%' : '%'}`;
}

const CATEGORY_KEYS: Readonly<Record<Category, MessageKey>> = {
  Social: 'cat_Social',
  Video: 'cat_Video',
  Work: 'cat_Work',
  Shopping: 'cat_Shopping',
  News: 'cat_News',
  Other: 'cat_Other',
};

export function categoryName(category: Category): string {
  return t(CATEGORY_KEYS[category]);
}

const SITE_KEYS: Readonly<Record<BlockedSite, MessageKey>> = {
  instagram: 'siteInstagram',
  youtube: 'siteYouTube',
  facebook: 'siteFacebook',
  x: 'siteX',
};

export function blockedSiteName(site: BlockedSite): string {
  return t(SITE_KEYS[site]);
}

export function visitsText(n: number): string {
  return n === 1 ? t('visits1') : t('visitsN', { n });
}

export function sitesText(n: number): string {
  return n === 1 ? t('sitesOne') : t('sitesCount', { n });
}
