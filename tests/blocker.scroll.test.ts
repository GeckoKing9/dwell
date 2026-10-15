import { describe, expect, it } from 'vitest';
import { canAbsorb, keySwallowed, touchSwallowed, wheelSwallowed, type ScrollBox } from '../src/blocker/scroll.ts';

/** A scroll container 100 px tall over 300 px of content, scrolled to `top`. */
function panel(top: number, patch: Partial<ScrollBox> = {}): ScrollBox {
  return { overflowY: 'auto', snapType: 'none', scrollTop: top, scrollHeight: 300, clientHeight: 100, ...patch };
}

const PLAIN: ScrollBox = { overflowY: 'visible', snapType: 'none', scrollTop: 0, scrollHeight: 50, clientHeight: 50 };
const FEED: ScrollBox = panel(100, { overflowY: 'scroll', snapType: 'y mandatory' });

describe('canAbsorb: can an ancestor below the page scroller take this scroll', () => {
  it('absorbs nothing with no ancestors', () => {
    expect(canAbsorb([], 1)).toBe(false);
    expect(canAbsorb([], 0)).toBe(false);
  });

  it('absorbs in a panel that still has room in the scroll direction', () => {
    expect(canAbsorb([PLAIN, panel(0)], 1)).toBe(true);
    expect(canAbsorb([panel(100)], -1)).toBe(true);
    expect(canAbsorb([panel(100)], 1)).toBe(true);
  });

  it('refuses a panel at its end, so the wheel does not chain to the viewer', () => {
    expect(canAbsorb([panel(200)], 1)).toBe(false);
    expect(canAbsorb([panel(199.5)], 1)).toBe(false);
    expect(canAbsorb([panel(0)], -1)).toBe(false);
    expect(canAbsorb([panel(200)], -1)).toBe(true);
  });

  it('passes over a panel at its end to an outer panel that can still scroll', () => {
    expect(canAbsorb([panel(200), PLAIN, panel(50)], 1)).toBe(true);
  });

  it.each(['y mandatory', 'y proximity', 'both mandatory', 'block mandatory', 'y'])(
    'never counts a vertical snap container (%s) as absorbing',
    (snapType) => {
      expect(canAbsorb([panel(50, { snapType })], 1)).toBe(false);
      expect(canAbsorb([panel(50, { snapType })], 0)).toBe(false);
    },
  );

  it('counts a horizontal-only snap container as absorbing', () => {
    expect(canAbsorb([panel(50, { snapType: 'x mandatory' })], 1)).toBe(true);
  });

  it.each(['visible', 'hidden', 'clip'])('never absorbs with overflow-y %s', (overflowY) => {
    expect(canAbsorb([panel(50, { overflowY })], 1)).toBe(false);
  });

  it('counts overflow-y scroll and overlay as scrollable', () => {
    expect(canAbsorb([panel(50, { overflowY: 'scroll' })], 1)).toBe(true);
    expect(canAbsorb([panel(50, { overflowY: 'overlay' })], 1)).toBe(true);
  });

  it('ignores content that overflows by one pixel or less', () => {
    expect(canAbsorb([panel(0, { scrollHeight: 101 })], 1)).toBe(false);
    expect(canAbsorb([panel(0, { scrollHeight: 102 })], 1)).toBe(true);
  });

  it('absorbs a touch move in any scrollable non-snap panel, whatever its position', () => {
    expect(canAbsorb([panel(200)], 0)).toBe(true);
    expect(canAbsorb([FEED], 0)).toBe(false);
  });

  it('stops reading ancestors at the first one that absorbs', () => {
    const read: number[] = [];
    function* chain(): Generator<ScrollBox> {
      read.push(1);
      yield panel(0);
      read.push(2);
      yield panel(0);
    }
    expect(canAbsorb(chain(), 1)).toBe(true);
    expect(read).toEqual([1]);
  });
});

describe('wheelSwallowed', () => {
  it('swallows a vertical wheel over the viewer', () => {
    expect(wheelSwallowed(0, 120, [FEED])).toBe(true);
    expect(wheelSwallowed(0, -120, [])).toBe(true);
    expect(wheelSwallowed(30, 30, [PLAIN])).toBe(true);
  });

  it('lets a horizontal or empty wheel through', () => {
    expect(wheelSwallowed(120, 10, [FEED])).toBe(false);
    expect(wheelSwallowed(0, 0, [FEED])).toBe(false);
    expect(wheelSwallowed(-50, 0, [])).toBe(false);
  });

  it('lets a wheel through inside a comments panel that can still scroll that way', () => {
    expect(wheelSwallowed(0, 120, [panel(0), FEED])).toBe(false);
    expect(wheelSwallowed(0, -120, [panel(200), FEED])).toBe(false);
  });

  it('swallows a wheel inside a comments panel already at its end', () => {
    expect(wheelSwallowed(0, 120, [panel(200), FEED])).toBe(true);
    expect(wheelSwallowed(0, -120, [panel(0), FEED])).toBe(true);
  });
});

describe('touchSwallowed', () => {
  const body = { tagName: 'BODY', isContentEditable: false, role: null };
  const up = { dx: 0, dy: 40, touches: 1 };

  it('swallows a vertical swipe over the viewer and lets one through inside a scrollable panel', () => {
    expect(touchSwallowed(up, body, [FEED])).toBe(true);
    expect(touchSwallowed(up, body, [PLAIN])).toBe(true);
    expect(touchSwallowed({ dx: 0, dy: -40, touches: 1 }, body, [FEED])).toBe(true);
    expect(touchSwallowed(up, body, [panel(100), FEED])).toBe(false);
  });

  it('swallows a swipe in a panel already at its end, so it does not chain to the viewer', () => {
    expect(touchSwallowed(up, body, [panel(200), FEED])).toBe(true);
  });

  it('lets a horizontal drag through: a seek bar or a carousel', () => {
    expect(touchSwallowed({ dx: 60, dy: 5, touches: 1 }, body, [FEED])).toBe(false);
  });

  it('lets a two-finger pinch through', () => {
    expect(touchSwallowed({ dx: 0, dy: 40, touches: 2 }, body, [FEED])).toBe(false);
  });

  it('lets a drag on a slider through', () => {
    expect(touchSwallowed(up, { tagName: 'DIV', isContentEditable: false, role: 'slider' }, [FEED])).toBe(false);
  });
});

describe('keySwallowed', () => {
  const body = { tagName: 'BODY', isContentEditable: false, role: null };

  it.each(['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'])('swallows %s on the viewer', (key) => {
    expect(keySwallowed(key, body)).toBe(true);
    expect(keySwallowed(key, null)).toBe(true);
  });

  it.each(['ArrowLeft', 'ArrowRight', ' ', 'j', 'Enter', 'Escape'])('lets %j through', (key) => {
    expect(keySwallowed(key, body)).toBe(false);
  });

  it.each([
    { tagName: 'INPUT', isContentEditable: false, role: null },
    { tagName: 'textarea', isContentEditable: false, role: null },
    { tagName: 'SELECT', isContentEditable: false, role: null },
    { tagName: 'DIV', isContentEditable: true, role: null },
    { tagName: 'DIV', isContentEditable: false, role: 'textbox' },
  ])('lets arrows through while typing in %o', (target) => {
    expect(keySwallowed('ArrowDown', target)).toBe(false);
    expect(keySwallowed('PageUp', target)).toBe(false);
  });

  it.each(['slider', 'spinbutton', 'menu', 'menuitem', 'listbox', 'option', 'combobox', 'radiogroup', 'radio', 'tablist', 'searchbox'])(
    'lets arrows through to a focused %s widget, which uses them itself',
    (role) => {
      expect(keySwallowed('ArrowDown', { tagName: 'DIV', isContentEditable: false, role })).toBe(false);
    },
  );
});
