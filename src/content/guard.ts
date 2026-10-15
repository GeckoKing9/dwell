/**
 * The guard on YouTube, Facebook and X: the core (`guard-core.ts`) alone. Instagram has its own entry,
 * `guard-instagram.ts`, with the pieces only Instagram needs.
 */
import { siteForHost } from '../blocker/patterns.ts';
import { startGuard } from './guard-core.ts';

const site = siteForHost(location.hostname);
if (site !== null && site !== 'instagram') startGuard(site);
