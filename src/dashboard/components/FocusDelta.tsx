import type { ComponentChildren } from 'preact';
import { t, tParts } from '../../shared/i18n.ts';
import { durationText } from '../../shared/ui/Duration.tsx';
import type { SiteWeek } from '../focus.ts';

/** The focused site against the same days of the week before: the rule and the base its Most used row uses. */
export function FocusDelta({ focus }: { focus: SiteWeek }) {
  const { delta } = focus;
  const d = durationText(focus.previous);
  const p = <b>{delta.percent}</b>;
  let parts: ComponentChildren = t('deltaNone');
  if (delta.kind === 'new') parts = t('focusDeltaNew');
  else if (delta.kind === 'same') parts = tParts<ComponentChildren>('focusDeltaSame', { d });
  else if (delta.kind === 'less') parts = tParts<ComponentChildren>('focusDeltaLess', { p, d });
  else if (delta.kind === 'more') parts = tParts<ComponentChildren>('focusDeltaMore', { p, d });
  return <p id="delta-line">{parts}</p>;
}
