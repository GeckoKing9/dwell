import { t } from '../../shared/i18n.ts';
import type { WeekModel } from '../model.ts';
import { Blocked } from './Blocked.tsx';
import { Categories } from './Categories.tsx';
import { Headline } from './Headline.tsx';
import { MostUsed } from './MostUsed.tsx';
import { PausedBanner } from './PausedBanner.tsx';
import { WeekChart } from './WeekChart.tsx';
import type { ChartProps } from './WeekChart.tsx';
import { WeekNav } from './WeekNav.tsx';

export interface WeekViewProps {
  model: WeekModel;
  paused: boolean;
  chart: ChartProps;
  showAll: boolean;
  onToggleAll(): void;
  onWeek(back: number): void;
  onOpenDay(date: string): void;
  onSite(site: string | null): void;
  onResume(): void;
}

/** Week navigator and headline, then the chart beside categories, then most used beside blocked. */
export function WeekView({ model, paused, chart, showAll, onToggleAll, onWeek, onOpenDay, onSite, onResume }: WeekViewProps) {
  return (
    <>
      {paused ? <PausedBanner onResume={onResume} /> : null}
      <WeekNav model={model} onWeek={onWeek} />
      <Headline model={model} onSite={onSite} />
      <div class="grid">
        <section class="panel" aria-labelledby="chart-title">
          <div class="panel-head">
            <h2 id="chart-title">{t('chartTitle')}</h2>
            <span class="aside">{t('chartAside')}</span>
          </div>
          <WeekChart model={model} onOpen={onOpenDay} {...chart} />
        </section>
        <Categories agg={model.agg} />
        <MostUsed model={model} showAll={showAll} onToggle={onToggleAll} onSite={onSite} />
        <Blocked blocked={model.agg.blocked} />
      </div>
    </>
  );
}
