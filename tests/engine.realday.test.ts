import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readLogExport } from '../src/store/log.ts';
import { DEFAULT_TRACKER_SETTINGS } from '../src/tracker/engine.ts';
import { replayLog } from '../src/tracker/replayLog.ts';
import { differences } from './support/differences.ts';

/** Event log exports of real days, kept out of version control; drop them in tests/fixtures/real/. */
const DIR = new URL('./fixtures/real/', import.meta.url);
const files = existsSync(DIR) ? readdirSync(DIR).filter((name) => name.endsWith('.json')).sort() : [];

describe('a real recorded day replays to its stored day records', () => {
  if (files.length === 0) {
    it.skip('no files in tests/fixtures/real/*.json, nothing to replay', () => undefined);
    return;
  }
  it.each(files)('%s: per-site per-hour seconds within 1 s and visits equal', (name) => {
    const file = readLogExport(JSON.parse(readFileSync(new URL(name, DIR), 'utf8')));
    const settings = { ...DEFAULT_TRACKER_SETTINGS, ...file.settings };
    const result = differences(file.days, replayLog(file.entries, settings, undefined, file.version).buckets);
    expect(result.problems).toEqual([]);
  });
});
