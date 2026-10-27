import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../shared/i18n.ts';
import { DashboardView } from './components/DashboardView.tsx';
import { applyChanges, loadDashboardData, withPending } from './data.ts';
import type { DashboardData, PageDeps, Pending } from './data.ts';
import { makeHandlers } from './handlers.ts';
import { keyAction, pressOf } from './keys.ts';
import { buildView } from './model.ts';
import { parseRoute, samePage } from './route.ts';
import type { Route } from './route.ts';
import { EMPTY_UI, mergeSeen } from './settingsUi.ts';
import type { SettingsUi } from './settingsUi.ts';

/* v8 ignore start -- @preserve: stateful glue, exercised by the dashboard e2e spec; the views, handlers, keys and actions it calls are unit-tested */
const DEFAULT_WIDTH = 720;
/** How often the clock moves while nothing is written: today's now line, the today highlight and midnight. */
const TICK_MS = 60_000;

/**
 * Reads every day key and the settings on open, then applies each relevant storage change in memory (a full
 * read only when a key is removed, a value does not read, or a read is still running), so the worker's
 * writes show while the page is open. The clock ticks once a minute. Routes follow the location hash; the
 * selected hour is page state, cleared when the week or day changes. Writes go through `makeHandlers`.
 */
export function App({ deps }: { deps: PageDeps }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Pending>({});
  const [route, setRoute] = useState<Route>(() => parseRoute(deps.hash.get()));
  const [active, setActive] = useState<number | null>(null);
  const [hour, setHour] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [ui, setUi] = useState<SettingsUi>(EMPTY_UI);
  const [undoUntil, setUndoUntil] = useState<number | null>(null);
  const latest = useRef(0);
  const inflight = useRef(0);
  const loaded = useRef<DashboardData | null>(null);
  const shown = useRef(route);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopObserving = useRef<(() => void) | null>(null);
  const onKey = useRef<((event: KeyboardEvent) => void) | null>(null);

  /** Only the newest read is applied, so a slow older read never overwrites a newer one. */
  const refresh = (): Promise<void> => {
    const request = ++latest.current;
    inflight.current++;
    return loadDashboardData(deps).then(
      (next) => {
        inflight.current--;
        if (request !== latest.current) return;
        loaded.current = next;
        setData(next);
        setFailed(false);
      },
      (error: unknown) => {
        inflight.current--;
        console.error('Dwell dashboard: reading storage failed', error);
        setFailed(true);
      },
    );
  };

  useEffect(() => {
    void refresh();
    return deps.onChange((changes) => {
      const next = loaded.current && inflight.current === 0 ? applyChanges(loaded.current, changes, deps.now()) : null;
      if (next === null) {
        void refresh();
        return;
      }
      loaded.current = next;
      setData(next);
    });
  }, [deps]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (loaded.current === null) return;
      loaded.current = { ...loaded.current, now: deps.now() };
      setData(loaded.current);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [deps]);

  useEffect(
    () =>
      deps.hash.onChange(() => {
        const next = parseRoute(deps.hash.get());
        if (!samePage(shown.current, next)) setHour(null);
        // A column index means a weekday on the week and an hour on a day: keep it (and its tooltip under a
        // focused or hovered column) while only the week or the day changes.
        if (shown.current.view !== next.view) setActive(null);
        shown.current = next;
        setRoute(next);
      }),
    [deps],
  );

  useEffect(() => deps.onKeyDown((event) => onKey.current?.(event)), [deps]);

  useEffect(() => {
    if (undoUntil === null) return undefined;
    const timer = setTimeout(() => setUndoUntil(null), Math.max(0, undoUntil - Date.now()));
    return () => clearTimeout(timer);
  }, [undoUntil]);

  const wrapRef = useCallback(
    (element: HTMLDivElement | null) => {
      stopObserving.current?.();
      stopObserving.current = element ? deps.observeWidth(element, setWidth) : null;
    },
    [deps],
  );

  const settings = useMemo(() => (data ? withPending(data.settings, pending) : null), [data, pending]);
  const view = useMemo(() => (data && settings ? buildView(route, { ...data, settings }) : null), [data, settings, route]);

  if (!view || !settings) {
    onKey.current = null;
    return (
      <div class="dash" aria-busy={failed ? undefined : 'true'}>
        {failed ? (
          <p class="dash-error" role="alert">
            {t('loadError')}
          </p>
        ) : null}
      </div>
    );
  }
  const handlers = makeHandlers({ deps, settings, ui, setUi, setPending, setShowAll, setUndoUntil, route, setHour, refresh, fileRef });
  onKey.current = (event) => {
    const action = keyAction(pressOf(event), { view, site: 'site' in route ? route.site : undefined, hour });
    if (action === null) return;
    event.preventDefault();
    if (action.kind === 'clearHour') handlers.onHour(null);
    else handlers.onRoute(action.route);
  };
  return (
    <DashboardView
      view={view}
      settings={settings}
      chart={{ width, active, onActive: setActive, wrapRef }}
      hour={hour}
      showAll={showAll}
      ui={{ ...ui, seenSplits: mergeSeen(ui.seenSplits, settings.overrides), undoOpen: undoUntil !== null }}
      on={handlers}
    />
  );
}
/* v8 ignore stop -- @preserve */
