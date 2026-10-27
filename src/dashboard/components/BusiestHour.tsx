import type { ComponentChildren } from 'preact';
import { tParts } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import { hourRangeText } from '../labels.ts';

export function BusiestHour({ peak, seconds }: { peak: number; seconds: number }) {
  return <p id="busiest-hour">{tParts<ComponentChildren>('busiestHour', { h: <b>{hourRangeText(peak)}</b>, d: durationText(seconds) })}</p>;
}
