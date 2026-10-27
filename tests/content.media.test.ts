import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeMedia {
  paused: boolean;
  ended: boolean;
  readyState: number;
  muted: boolean;
  volume: number;
}

type Handler = (event: Event) => void;

interface Page {
  readonly sent: unknown[];
  readonly media: FakeMedia[];
  visibility: 'visible' | 'hidden';
  pip: boolean;
  focused: boolean;
  fire(target: 'document' | 'window' | 'root', type: string, event?: Partial<Event>): void;
}

/** The smallest world media.ts runs in: a top frame with listeners, its media elements, a live extension. */
function installPage(): Page {
  const listeners = new Map<string, Handler[]>();
  const target = (name: string) => ({
    addEventListener: (type: string, handler: Handler) => listeners.set(`${name}:${type}`, [...(listeners.get(`${name}:${type}`) ?? []), handler]),
    removeEventListener: () => undefined,
  });
  const media: FakeMedia[] = [];
  const sent: unknown[] = [];
  const page: Page = {
    sent,
    media,
    visibility: 'visible',
    pip: false,
    focused: false,
    fire: (name, type, event = { isTrusted: true }) => {
      for (const handler of listeners.get(`${name}:${type}`) ?? []) handler(event as Event);
    },
  };
  vi.stubGlobal('document', {
    ...target('document'),
    documentElement: target('root'),
    querySelectorAll: () => media,
    hasFocus: () => page.focused,
    get visibilityState() {
      return page.visibility;
    },
    get pictureInPictureElement() {
      return page.pip ? {} : null;
    },
  });
  vi.stubGlobal('window', target('window'));
  vi.stubGlobal('HTMLMediaElement', { HAVE_CURRENT_DATA: 2 });
  vi.stubGlobal('chrome', { runtime: { id: 'test', sendMessage: async (message: unknown) => void sent.push(message) } });
  return page;
}

const PLAYING_WITH_SOUND: FakeMedia = { paused: false, ended: false, readyState: 4, muted: false, volume: 1 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function start(): Promise<Page> {
  const page = installPage();
  await import('../src/content/media.ts');
  vi.advanceTimersByTime(5000);
  page.sent.length = 0;
  return page;
}

describe('the media content script', () => {
  it('sends its first answer even when nothing plays, so a playing state left by the previous document is cleared', async () => {
    const page = installPage();
    await import('../src/content/media.ts');
    vi.advanceTimersByTime(5000);
    expect(page.sent).toEqual([{ type: 'media', playing: false, watched: false }]);
  });

  it('then sends only changes: a start with sound on screen, and the stop when the page is left', async () => {
    const page = await start();
    vi.advanceTimersByTime(10_000);
    page.media.push({ ...PLAYING_WITH_SOUND });
    page.fire('document', 'playing');
    vi.advanceTimersByTime(10_000);
    page.fire('window', 'pagehide');
    expect(page.sent).toEqual([
      { type: 'media', playing: true, watched: true },
      { type: 'media', playing: false, watched: false },
    ]);
  });

  it('reports muted or silent playback as playing but not watched', async () => {
    const page = await start();
    page.media.push({ ...PLAYING_WITH_SOUND, muted: true });
    page.fire('document', 'playing');
    page.media[0] = { ...PLAYING_WITH_SOUND, volume: 0 };
    page.fire('document', 'volumechange');
    page.media[0] = { ...PLAYING_WITH_SOUND };
    page.fire('document', 'volumechange');
    expect(page.sent).toEqual([
      { type: 'media', playing: true, watched: false },
      { type: 'media', playing: true, watched: true },
    ]);
  });

  it('stops calling playback watched when the page is hidden, unless it plays in picture-in-picture', async () => {
    const page = await start();
    page.media.push({ ...PLAYING_WITH_SOUND });
    page.fire('document', 'playing');
    page.visibility = 'hidden';
    page.fire('document', 'visibilitychange');
    page.pip = true;
    page.fire('document', 'enterpictureinpicture');
    expect(page.sent).toEqual([
      { type: 'media', playing: true, watched: true },
      { type: 'media', playing: true, watched: false },
      { type: 'media', playing: true, watched: true },
    ]);
  });
});

describe('attention', () => {
  it('pings on input while the page lacks focus, at most once every 10 s', async () => {
    const page = await start();
    page.fire('window', 'wheel');
    vi.advanceTimersByTime(4000);
    page.fire('window', 'wheel');
    vi.advanceTimersByTime(6000);
    page.fire('window', 'wheel');
    expect(page.sent).toEqual([
      { type: 'attention', present: true },
      { type: 'attention', present: true },
    ]);
  });

  it('ignores synthetic events', async () => {
    const page = await start();
    page.fire('window', 'wheel', { isTrusted: false });
    expect(page.sent).toEqual([]);
  });

  it('sends nothing while the page has focus and the pointer stays on it', async () => {
    const page = await start();
    page.focused = true;
    for (const type of ['wheel', 'keydown', 'pointerdown', 'touchstart']) page.fire('window', type);
    page.fire('root', 'mouseleave');
    expect(page.sent).toEqual([]);
  });

  it('sends nothing when the pointer leaves a focused page and input comes back: the toolbar round trip costs no message', async () => {
    const page = await start();
    page.focused = true;
    page.fire('root', 'mouseleave');
    page.fire('window', 'wheel');
    page.fire('root', 'mouseleave');
    expect(page.sent).toEqual([]);
  });

  it('takes attention back when the pointer leaves or the page is hidden, once, and pings again on the next input', async () => {
    const page = await start();
    page.fire('window', 'wheel');
    page.fire('root', 'mouseleave');
    page.fire('root', 'mouseleave');
    page.fire('window', 'wheel');
    page.visibility = 'hidden';
    page.fire('document', 'visibilitychange');
    expect(page.sent).toEqual([
      { type: 'attention', present: true },
      { type: 'attention', present: false },
      { type: 'attention', present: true },
      { type: 'attention', present: false },
    ]);
  });
});
