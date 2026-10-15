import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeMedia {
  paused: boolean;
  ended: boolean;
  readyState: number;
}

interface Page {
  readonly sent: unknown[];
  readonly media: FakeMedia[];
  fire(target: 'document' | 'window', type: string): void;
}

/** The smallest world media.ts runs in: a top frame with listeners, its media elements, a live extension. */
function installPage(): Page {
  const listeners = new Map<string, (() => void)[]>();
  const target = (name: string) => ({
    addEventListener: (type: string, handler: () => void) => listeners.set(`${name}:${type}`, [...(listeners.get(`${name}:${type}`) ?? []), handler]),
    removeEventListener: () => undefined,
  });
  const media: FakeMedia[] = [];
  const sent: unknown[] = [];
  vi.stubGlobal('document', { ...target('document'), querySelectorAll: () => media });
  vi.stubGlobal('window', target('window'));
  vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: async (message: unknown) => void sent.push(message) } });
  return {
    sent,
    media,
    fire: (name, type) => {
      for (const handler of listeners.get(`${name}:${type}`) ?? []) handler();
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the media content script', () => {
  it('sends its first answer even when nothing plays, so a playing state left by the previous document is cleared', async () => {
    const page = installPage();
    await import('../src/content/media.ts');
    vi.advanceTimersByTime(5000);
    expect(page.sent).toEqual([{ type: 'media', playing: false }]);
  });

  it('then sends only changes: a start, and the stop when the page is hidden', async () => {
    const page = installPage();
    await import('../src/content/media.ts');
    vi.advanceTimersByTime(15_000);
    page.media.push({ paused: false, ended: false, readyState: 4 });
    page.fire('document', 'playing');
    vi.advanceTimersByTime(10_000);
    page.fire('window', 'pagehide');
    expect(page.sent).toEqual([
      { type: 'media', playing: false },
      { type: 'media', playing: true },
      { type: 'media', playing: false },
    ]);
  });
});
