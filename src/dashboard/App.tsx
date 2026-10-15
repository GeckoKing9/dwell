import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../shared/i18n.ts';
import { DashboardView } from './components/DashboardView.tsx';
import { loadDashboardData, withPending } from './data.ts';
import type { DashboardData, PageDeps, Pending } from './data.ts';
import { makeHandlers } from './handlers.ts';
import { buildView } from './model.ts';
import { parseRoute } from './route.ts';
import type { Route } from './route.ts';
import { EMPTY_UI, mergeSeen } from './settingsUi.ts';
import type { SettingsUi } from './settingsUi.ts';

/* v8 ignore start -- @preserve: stateful glue, exercised by the dashboard e2e spec; the views, handlers and actions it calls are unit-tested */
const DEFAULT_WIDTH = 720;

/**
 * Reads every day key and the settings on open and on every relevant storage change, so the worker's
 * writes show while the page is open. Routes follow the location hash; writes go through `makeHandlers`.
 */
export function App({ deps }: { deps: PageDeps }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Pending>({});
  const [route, setRoute] = useState<Route>(() => parseRoute(deps.hash.get()));
  const [active, setActive] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [ui, setUi] = useState<SettingsUi>(EMPTY_UI);
  const [undoUntil, setUndoUntil] = useState<number | null>(null);
  const latest = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const stopObserving = useRef<(() => void) | null>(null);

  /** Only the newest read is applied, so a slow older read never overwrites a newer one. */
  const refresh = (): Promise<void> => {
    const request = ++latest.current;
    return loadDashboardData(deps).then(
      (next) => {
        if (request !== latest.current) return;
        setData(next);
        setFailed(false);
      },
      (error: unknown) => {
        console.error('Dwell dashboard: reading storage failed', error);
        setFailed(true);
      },
    );
  };

  useEffect(() => {
    void refresh();
    return deps.onChange(() => void refresh());
  }, [deps]);

  useEffect(
    () =>
      deps.hash.onChange(() => {
        setRoute(parseRoute(deps.hash.get()));
        setActive(null);
      }),
    [deps],
  );

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
  const handlers = makeHandlers({ deps, settings, ui, setUi, setPending, setShowAll, setUndoUntil, refresh, fileRef });
  return (
    <DashboardView
      view={view}
      settings={settings}
      chart={{ width, active, onActive: setActive, wrapRef }}
      showAll={showAll}
      ui={{ ...ui, seenSplits: mergeSeen(ui.seenSplits, settings.overrides), undoOpen: undoUntil !== null }}
      on={handlers}
    />
  );
}
/* v8 ignore stop -- @preserve */
