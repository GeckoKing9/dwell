import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t } from '../shared/i18n.ts';
import type { PauseMessage, SettingsMessage } from '../shared/messages.ts';
import { PopupView } from './components/PopupView.tsx';
import { addPending, buildModel, loadPopupData, settlePending, withPending } from './data.ts';
import type { BlockerKey, Pending, PopupData, PopupDeps } from './data.ts';

/**
 * Reads on open and again on every relevant storage change, so the worker's writes show while the popup
 * is open. Taps render at once and are sent to the worker; the stored value wins once it answers.
 */
export function Popup({ deps }: { deps: PopupDeps }) {
  const [data, setData] = useState<PopupData | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState<Pending>({});
  const [activeDay, setActiveDay] = useState<number | null>(null);
  const latest = useRef(0);

  /** Only the newest read is applied, so a slow older read never overwrites a newer one. */
  const refresh = (): Promise<void> => {
    const request = ++latest.current;
    return loadPopupData(deps).then(
      (next) => {
        if (request !== latest.current) return;
        setData(next);
        setFailed(false);
      },
      (error: unknown) => {
        console.error('Dwell popup: reading storage failed', error);
        setFailed(true);
      },
    );
  };

  useEffect(() => {
    void refresh();
    return deps.onChange(() => void refresh());
  }, [deps]);

  const send = (change: Pending, message: PauseMessage | SettingsMessage): void => {
    setPending((p) => addPending(p, change));
    deps
      .send(message)
      .catch((error: unknown) => console.error('Dwell popup: the change was not applied', error))
      .then(refresh)
      .finally(() => setPending((p) => settlePending(p, change)));
  };

  const model = useMemo(() => (data ? buildModel({ ...data, settings: withPending(data.settings, pending) }) : null), [data, pending]);

  if (!model) {
    return (
      <div class="popup" aria-busy={failed ? undefined : 'true'}>
        {failed ? (
          <p class="pp-error" role="alert">
            {t('loadError')}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <PopupView
      model={model}
      activeDay={activeDay}
      onActiveDay={setActiveDay}
      onPause={(paused) => send({ paused }, { type: 'pause', paused })}
      onBlocker={(key: BlockerKey, on: boolean) => send({ blockers: { [key]: on } }, { type: 'settings', patch: { blockers: { [key]: on } } })}
      onOpenDashboard={() => {
        deps.openDashboard().catch((error: unknown) => console.error('Dwell popup: opening the dashboard failed', error));
      }}
    />
  );
}
