import { describe, expect, it } from 'vitest';
import { HOT_VERSION, readEngineState } from '../src/background/state.ts';
import { createInitialState } from '../src/tracker/engine.ts';

const base = createInitialState(1_000);

describe('the stored hot state', () => {
  it('reads back an engine state with and without attention', () => {
    expect(readEngineState({ version: HOT_VERSION, engine: base })).toEqual(base);
    const held = { ...base, attention: { tabId: 8, windowId: 2, at: 900 } };
    expect(readEngineState({ version: HOT_VERSION, engine: held })).toEqual(held);
  });

  it.each([
    ['a string', 'tab 8'],
    ['a fractional tab id', { tabId: 8.5, windowId: 2, at: 900 }],
    ['a missing window id', { tabId: 8, at: 900 }],
    ['a time that is not a number', { tabId: 8, windowId: 2, at: 'soon' }],
    ['an infinite time', { tabId: 8, windowId: 2, at: Infinity }],
  ])('counts the state as missing when attention is %s', (_label, attention) => {
    expect(readEngineState({ version: HOT_VERSION, engine: { ...base, attention } })).toBeNull();
  });
});
