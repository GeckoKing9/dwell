/**
 * Every control's callback, built from the state App owns. Kept apart from App so the wiring
 * (what each tap sends, what it shows) is unit-tested without a DOM.
 */
import type { RefObject } from 'preact';
import { t } from '../shared/i18n.ts';
import type { PageMessage, SettingsPatch } from '../shared/messages.ts';
import type { Settings } from '../store/schema.ts';
import { checkIgnoreHost, checkSplitHost, deleteEverything, exportData, exportEventLog, importData, undoDelete } from './actions.ts';
import type { DashboardHandlers } from './components/DashboardView.tsx';
import { replyFailure, settlePending, shownFor } from './data.ts';
import type { Pending, PageDeps } from './data.ts';
import { routeHash, toggleSite, withSite } from './route.ts';
import type { Route } from './route.ts';
import { mergeSeen } from './settingsUi.ts';
import type { ListField, NoticeSlot, SettingsUi } from './settingsUi.ts';

type Update<T> = (next: T | ((previous: T) => T)) => void;

export interface HandlerContext {
  deps: PageDeps;
  /** Settings as shown, pending changes included. */
  settings: Settings;
  ui: SettingsUi;
  setUi: Update<SettingsUi>;
  setPending: Update<Pending>;
  setShowAll: Update<boolean>;
  setUndoUntil: Update<number | null>;
  /** The route on screen: navigation keeps its focused site. */
  route: Route;
  setHour: Update<number | null>;
  refresh(): Promise<void>;
  fileRef: RefObject<HTMLInputElement | null>;
}

export function makeHandlers(ctx: HandlerContext): DashboardHandlers {
  const { deps, settings, ui, setUi } = ctx;
  const notice = (slot: NoticeSlot, text: string | undefined): void => setUi((u) => ({ ...u, notices: { ...u.notices, [slot]: text } }));
  const fail =
    (slot: NoticeSlot) =>
    (error: unknown): void => {
      console.error('Dwell dashboard: the action failed', error);
      notice(slot, t('changeFailed', { r: error instanceof Error ? error.message : String(error) }));
    };
  const { route } = ctx;
  const site = 'site' in route ? route.site : undefined;
  /** Moving between the week and the day view starts at the top; moving within one keeps the scroll position. */
  const go = (next: Route): void => {
    if (next.view !== route.view) deps.scrollTop();
    deps.hash.set(routeHash(next));
  };
  const setField = (field: ListField, draft: string, error: string): void =>
    setUi((u) => ({ ...u, drafts: { ...u.drafts, [field]: draft }, errors: { ...u.errors, [field]: error } }));

  /** Shows the change at once, sends it, then reads back what the worker stored. */
  const post = (message: PageMessage, shown: Pending): Promise<void> => {
    ctx.setPending((p) => ({ ...p, ...shown }));
    return deps
      .send(message)
      .then((reply) => {
        const failure = replyFailure(reply);
        notice('settings', failure === null ? undefined : t('changeFailed', { r: failure }));
      })
      .catch(fail('settings'))
      .then(ctx.refresh)
      .finally(() => ctx.setPending((p) => settlePending(p, shown)));
  };

  const change = (patch: SettingsPatch): void => {
    if (patch.overrides) {
      const after = patch.overrides;
      setUi((u) => ({ ...u, seenSplits: mergeSeen(mergeSeen(u.seenSplits, settings.overrides), after) }));
    }
    void post({ type: 'settings', patch }, shownFor(settings, patch));
  };

  return {
    onWeek: (back) => go(withSite({ view: 'week', back }, site)),
    onDay: (date) => go(withSite({ view: 'day', date }, site)),
    onRoute: go,
    onSite: (next) => go(toggleSite(route, next)),
    onHour: (hour) => ctx.setHour((current) => (hour === null || hour === current ? null : hour)),
    onResume: () => void post({ type: 'pause', paused: false }, { paused: false }),
    onToggleAll: () => ctx.setShowAll((v) => !v),
    onUndo: () => {
      undoDelete(deps).then((text) => {
        ctx.setUndoUntil(null);
        notice('delete', text);
      }, fail('delete'));
    },
    settings: {
      change,
      pause: (paused) => void post({ type: 'pause', paused }, { paused }),
      draft: (field, value) => setField(field, value, ''),
      add: (field) => {
        const raw = ui.drafts[field];
        const check = field === 'ignore' ? checkIgnoreHost(raw, settings.ignore) : checkSplitHost(raw, settings.overrides);
        if (!check.ok) return setField(field, raw, check.error);
        setField(field, '', '');
        change(field === 'ignore' ? { ignore: [...settings.ignore, check.host] } : { overrides: [...settings.overrides, check.host] });
      },
      removeIgnore: (host) => change({ ignore: settings.ignore.filter((h) => h !== host) }),
      exportJson: () => {
        exportData(deps, deps.now()).then((text) => notice('export', text), fail('export'));
      },
      exportLog: () => {
        exportEventLog(deps, deps.now()).then((text) => notice('log', text), fail('log'));
      },
      importFile: (file) => {
        deps
          .readFile(file)
          .then((text) => importData(deps, file.name, text))
          .then((text) => notice('import', text), fail('import'))
          .then(ctx.refresh);
      },
      deleteAll: () => {
        deleteEverything(deps)
          .then((outcome) => {
            if (outcome.ok) ctx.setUndoUntil(outcome.undoUntil);
            notice('delete', outcome.ok ? undefined : outcome.error);
          }, fail('delete'))
          .then(ctx.refresh);
      },
      jump: (id) => deps.scrollTo(id),
      fileRef: ctx.fileRef,
    },
  };
}
