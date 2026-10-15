/** First letter of a site, ignoring a leading `www.`. */
export function letterOf(site: string): string {
  return (site.replace(/^www\./, '')[0] ?? '?').toUpperCase();
}

/** The round letter mark beside a domain. `blank` is the placeholder for pages that are not sites. */
export function LetterMark({ site, blank = false }: { site: string; blank?: boolean }) {
  return (
    <span class={blank ? 'mark is-blank' : 'mark'} aria-hidden="true">
      {blank ? '\u2013' : letterOf(site)}
    </span>
  );
}
