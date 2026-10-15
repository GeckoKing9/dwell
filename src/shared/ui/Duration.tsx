import { Fragment } from 'preact';
import { formatDuration, formatDurationParts, noBreak } from '../../stats/format.ts';
import { uiLang } from '../i18n.ts';

/** A duration as plain text that never breaks across lines: '3h 32m'. */
export function durationText(seconds: number): string {
  return noBreak(formatDuration(seconds, uiLang()));
}

interface DurationProps {
  seconds: number;
  class?: string;
  /** The element to render; the popup hero is the page heading. */
  as?: 'span' | 'h1';
}

/**
 * A duration with units set smaller than the digits (`2`h `13`m). The typeset parts are hidden from
 * assistive technology, which reads the plain-text version instead.
 */
export function Duration({ seconds, class: cls, as: Tag = 'span' }: DurationProps) {
  const parts = formatDurationParts(seconds, uiLang());
  return (
    <Tag class={cls}>
      <span aria-hidden="true">
        {parts.map((p, i) => (
          <Fragment key={i}>
            {p.value}
            <span class="unit">{p.unit}</span>
          </Fragment>
        ))}
      </span>
      <span class="sr">{durationText(seconds)}</span>
    </Tag>
  );
}
