import type { BlockerKey, PopupModel } from '../data.ts';
import { Footer } from './Footer.tsx';
import { Hero } from './Hero.tsx';
import { PausedBand } from './PausedBand.tsx';
import { ThisSite } from './ThisSite.tsx';
import { TopSites } from './TopSites.tsx';
import { WeekChart } from './WeekChart.tsx';

export interface PopupHandlers {
  onPause(paused: boolean): void;
  onBlocker(key: BlockerKey, on: boolean): void;
  onOpenDashboard(): void;
  onActiveDay(index: number | null): void;
}

interface PopupViewProps extends PopupHandlers {
  model: PopupModel;
  activeDay: number | null;
}

/** Top to bottom: today, the 7-day chart, top sites, this site and its blocker, the footer. */
export function PopupView({ model, activeDay, onPause, onBlocker, onOpenDashboard, onActiveDay }: PopupViewProps) {
  const { paused, firstRun } = model;
  return (
    <div class={paused ? 'popup is-paused' : 'popup'} data-state={model.state}>
      {paused ? <PausedBand onResume={() => onPause(false)} /> : null}
      <div class="pp-body">
        <Hero now={model.now} total={model.total} usual={model.usual} paused={paused} firstRun={firstRun} />
        <WeekChart days={model.week} empty={firstRun} paused={paused} active={activeDay} onActive={onActiveDay} />
        <TopSites sites={firstRun ? [] : model.top} />
        <ThisSite site={model.site} paused={paused} firstRun={firstRun} onBlocker={onBlocker} />
      </div>
      <Footer paused={paused} onPause={onPause} onOpenDashboard={onOpenDashboard} />
    </div>
  );
}
