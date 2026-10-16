/**
 * The guard on YouTube and X: the core (`guard-core.ts`) alone. Instagram and Facebook have their own entries,
 * `guard-instagram.ts` and `guard-facebook.ts`, with the pieces only they need.
 */
import { siteForHost } from '../blocker/patterns.ts';
import { startGuard } from './guard-core.ts';

const site = siteForHost(location.hostname);
if (site === 'youtube' || site === 'x') startGuard(site);
