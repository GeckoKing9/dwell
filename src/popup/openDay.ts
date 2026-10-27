/**
 * Shows a day of the dashboard from the popup: in the open dashboard tab when there is one (its router
 * follows the hash), else in a new tab. The address is built only by `dashboardDayUrl`, the popup's one
 * target in the navigation allowlist. Chrome comes in through `OpenDayApi`, so this runs in tests.
 */
import { dashboardDayUrl } from '../blocker/targets.ts';

export interface OpenDayApi {
  query(): Promise<{ id?: number | undefined; windowId: number; url?: string | undefined; pendingUrl?: string | undefined }[]>;
  update(tabId: number, props: { url: string; active: true }): Promise<unknown>;
  create(props: { url: string }): Promise<unknown>;
  focus(windowId: number): Promise<unknown>;
  /** The dashboard without a day, for an address the allowlist refuses. */
  fallback(): Promise<void>;
}

/** `dashboard` is the dashboard page's own address (from the manifest). A second click while one is opening joins it. */
export function createOpenDay(api: OpenDayApi, dashboard: string): (date: string) => Promise<void> {
  let pending: Promise<void> | null = null;

  async function open(date: string): Promise<void> {
    const url = dashboardDayUrl(dashboard, date);
    if (url === null) return api.fallback();
    // A tab still loading has no `url` yet, only `pendingUrl`.
    const tab = (await api.query()).find((t) => (t.url || t.pendingUrl || '').startsWith(dashboard));
    if (tab?.id !== undefined) {
      // The tab can close between the query and the update; then a new tab shows the day instead.
      const shown = await api.update(tab.id, { url, active: true }).then(
        () => true,
        () => false,
      );
      if (shown) {
        await api.focus(tab.windowId);
        return;
      }
    }
    await api.create({ url });
  }

  return (date) => {
    pending ??= open(date).finally(() => {
      pending = null;
    });
    return pending;
  };
}
