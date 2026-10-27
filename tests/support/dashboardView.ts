import { vi } from 'vitest';
import { DashboardView } from '../../src/dashboard/components/DashboardView.tsx';
import type { DashboardHandlers } from '../../src/dashboard/components/DashboardView.tsx';
import type { ChartProps } from '../../src/dashboard/components/WeekChart.tsx';
import type { DashboardData } from '../../src/dashboard/data.ts';
import { buildView } from '../../src/dashboard/model.ts';
import type { Route } from '../../src/dashboard/route.ts';
import { EMPTY_UI } from '../../src/dashboard/settingsUi.ts';
import type { SettingsUi } from '../../src/dashboard/settingsUi.ts';
import { expand } from './vnode.ts';
import type { Tree } from './vnode.ts';

export function handlers(): DashboardHandlers {
  return {
    onWeek: vi.fn(),
    onDay: vi.fn(),
    onRoute: vi.fn(),
    onSite: vi.fn(),
    onHour: vi.fn(),
    onResume: vi.fn(),
    onToggleAll: vi.fn(),
    onUndo: vi.fn(),
    settings: {
      change: vi.fn(),
      pause: vi.fn(),
      draft: vi.fn(),
      add: vi.fn(),
      removeIgnore: vi.fn(),
      exportJson: vi.fn(),
      exportLog: vi.fn(),
      importFile: vi.fn(),
      deleteAll: vi.fn(),
      jump: vi.fn(),
      fileRef: { current: null },
    },
  };
}

export interface RenderOptions {
  chart?: Partial<ChartProps>;
  hour?: number | null;
  showAll?: boolean;
  ui?: Partial<SettingsUi>;
  on?: DashboardHandlers;
}

/** The whole page for a route, rendered to a plain tree. */
export function renderDashboard(route: Route, data: DashboardData, options: RenderOptions = {}): Tree[] {
  return expand(
    DashboardView({
      view: buildView(route, data),
      settings: data.settings,
      chart: { width: 720, active: null, onActive: vi.fn(), wrapRef: null, ...options.chart },
      hour: options.hour ?? null,
      showAll: options.showAll ?? false,
      ui: { ...EMPTY_UI, ...options.ui },
      on: options.on ?? handlers(),
    }),
  );
}
