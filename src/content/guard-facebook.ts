/**
 * The guard on Facebook: the core (`guard-core.ts`) plus Facebook's reel rule. The viewer's Next and Previous
 * Card buttons are hidden (`facebook.css`) and the input lock holds the wheel, keys and swipes, so nothing on
 * screen moves the viewer; a move that happens anyway is put back with the viewer's own Previous Card, in
 * this document. The reel opened is the viewer's first card, so one step back is always that reel. Measured
 * live, signed out, 2026-10-15: a card click replaces the address within a microtask and redraws the reel,
 * Previous Card on the first card does nothing, and Facebook's router changes the address without redrawing
 * the viewer, so it is not used here.
 */
import { isAllowedTarget } from '../blocker/targets.ts';
import { facebookReelCode } from '../blocker/viewer.ts';
import { startGuard, type GuardPort } from './guard-core.ts';

/** The English and French UI's labels; in another language the button is not found and the core loads the reel instead. */
const PREVIOUS_CARD = '[aria-label="Previous Card"], [aria-label="Carte précédente"]';
/** A card click moves the viewer within a microtask (measured); after this long, one that did not move never will. */
const LANDING_MS = 250;

/**
 * Puts the viewer back one card, onto reel `target`; true when it clicked. A viewer that did not move (the reel
 * on screen is its own first card, or the button belongs to a viewer no longer shown) gets `target` loaded,
 * counted on landing; one that moved is counted here.
 */
function putBack(guard: GuardPort, target: string): boolean {
  if (facebookReelCode(target) === null) return false;
  const previous = document.querySelector<HTMLElement>(PREVIOUS_CARD);
  if (previous === null) return false;
  const moved = location.href;
  // shortcut: two moves inside one task (none seen live; nothing on screen moves the viewer) are each put back
  // one card, and the second finds the first reel already there, which the core reloads; upgrade if that is seen.
  previous.click();
  setTimeout(() => {
    if (location.href !== moved) guard.count('facebook');
    else if (isAllowedTarget(target)) location.replace(target);
  }, LANDING_MS);
  return true;
}

startGuard('facebook', (guard) => ({
  postCode: facebookReelCode,
  openInPlace: (target) => putBack(guard, target),
}));
