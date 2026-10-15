import type { Settings } from '../../store/schema.ts';
import type { View } from '../model.ts';
import type { SettingsHandlers, SettingsUi } from '../settingsUi.ts';
import { DayView } from './DayView.tsx';
import { Header } from './Header.tsx';
import { Privacy } from './Privacy.tsx';
import { SettingsView } from './SettingsView.tsx';
import { UndoToast } from './UndoToast.tsx';
import type { ChartProps } from './WeekChart.tsx';
import { WeekView } from './WeekView.tsx';

export interface DashboardHandlers {
  onWeek(back: number): void;
  onDay(date: string): void;
  onResume(): void;
  onToggleAll(): void;
  onUndo(): void;
  settings: SettingsHandlers;
}

interface DashboardViewProps {
  view: View;
  settings: Settings;
  chart: ChartProps;
  showAll: boolean;
  ui: SettingsUi;
  on: DashboardHandlers;
}

function Main({ view, settings, chart, showAll, ui, on }: DashboardViewProps) {
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
          onResume={on.onResume}
        />
      );
    case 'day':
      return <DayView model={view.model} paused={settings.paused} chart={chart} onWeek={on.onWeek} onDay={on.onDay} onResume={on.onResume} />;
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
