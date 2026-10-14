import { mkdirSync, writeFileSync } from 'node:fs';
import { simulateDays } from '../src/stats/simulate.ts';
import { DEFAULT_SETTINGS, EXPORT_FORMAT, dateString, parseDayKey } from '../src/store/schema.ts';
import type { DayRecord, ExportFile } from '../src/store/schema.ts';

const DEFAULT_SEED = 20261014;
const arg = process.argv[2];
const seed = arg === undefined ? DEFAULT_SEED : Number(arg);
if (!Number.isInteger(seed)) {
  console.error('usage: npm run simulate [-- <integer seed>]');
  process.exit(1);
}

const now = new Date();
const days: Record<string, DayRecord> = {};
for (const [key, record] of Object.entries(simulateDays(seed, now))) {
  const date = parseDayKey(key);
  if (date) days[dateString(date)] = record;
}

const file: ExportFile = {
  format: EXPORT_FORMAT,
  version: 1,
  exportedAt: now.toISOString(),
  days,
  settings: DEFAULT_SETTINGS,
};

mkdirSync('scratch', { recursive: true });
const path = `scratch/dwell-export-${seed}.json`;
writeFileSync(path, JSON.stringify(file));
console.log(`wrote ${path} (${Object.keys(days).length} days, seed ${seed})`);
