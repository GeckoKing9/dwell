import type { Settings } from '../../store/schema.ts';
import type { View } from '../model.ts';
import type { Route } from '../route.ts';
import type { SettingsHandlers, SettingsUi } from '../settingsUi.ts';
import { DayView } from './DayView.tsx';
import { Header } from './Header.tsx';
import { Privacy } from './Privacy.tsx';
import { SettingsView } from './SettingsView.tsx';
import { UndoToast } from './UndoToast.tsx';
import type { ChartProps } from './WeekChart.tsx';
import { WeekView } from './WeekView.tsx';

export interface DashboardHandlers {
  /** Another week or day; the focused site goes along. */
  onWeek(back: number): void;
  onDay(date: string): void;
  /** Any route, as the keyboard picks it. */
  onRoute(route: Route): void;
  /** Focuses a site; the focused site again, or null, clears it. */
  onSite(site: string | null): void;
  /** Selects an hour of the day view; the selected hour again, or null, clears it. */
  onHour(hour: number | null): void;
  onResume(): void;
  onToggleAll(): void;
  onUndo(): void;
  settings: SettingsHandlers;
}

interface DashboardViewProps {
  view: View;
  settings: Settings;
  chart: ChartProps;
  /** The selected hour of the day view, or null. */
  hour: number | null;
  showAll: boolean;
  ui: SettingsUi;
  on: DashboardHandlers;
}

function Main({ view, settings, chart, hour, showAll, ui, on }: DashboardViewProps) {
  switch (view.kind) {
    case 'week':
      return (
        <WeekView
          model={view.model}
          paused={settings.paused}
          chart={chart}
          showAll={showAll}
          onToggleAll={on.onToggleAll}
          onWeek={on.onWeek}
          onOpenDay={on.onDay}
          onSite={on.onSite}
          onResume={on.onResume}
        />
      );
    case 'day':
      return <DayView model={view.model} paused={settings.paused} chart={chart} hour={hour} on={on} />;
    case 'settings':
      return <SettingsView settings={settings} sites={view.sites} ui={ui} on={on.settings} />;
    case 'privacy':
      return <Privacy />;
  }
}

/** Header, then the routed view; the undo toast stays up across views until its 10 seconds are over. */
export function DashboardView(props: DashboardViewProps) {
  const { view, settings, ui, on } = props;
  const current = view.kind === 'week' || view.kind === 'day' ? 'activity' : view.kind;
  return (
    <div class="dash" data-view={view.kind}>
      <Header current={current} paused={settings.paused} />
      <main class="dash-main">
        <Main {...props} />
      </main>
      {ui.undoOpen ? <UndoToast onUndo={on.onUndo} /> : null}
    </div>
  );
}
