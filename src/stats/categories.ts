import type { Category, Site } from '../store/schema.ts';

const WORK = ['github.com', 'docs.google.com', 'mail.google.com', 'stackoverflow.com', 'notion.so', 'slack.com', 'linear.app', 'figma.com'];
const SOCIAL = ['instagram.com', 'facebook.com', 'messenger.com', 'reddit.com', 'x.com', 'tiktok.com', 'threads.net', 'linkedin.com', 'discord.com'];
const VIDEO = ['youtube.com', 'netflix.com', 'twitch.tv', 'primevideo.com', 'disneyplus.com', 'crave.ca', 'vimeo.com'];
const SHOPPING = ['amazon.ca', 'amazon.com', 'ebay.ca', 'bestbuy.ca', 'aliexpress.com', 'etsy.com'];
const NEWS = ['lapresse.ca', 'ledevoir.com', 'nytimes.com', 'theguardian.com', 'bbc.co.uk', 'cbc.ca', 'radio-canada.ca', 'lemonde.fr'];

/** Built-in domain map the user can edit (R23). A fresh object on every call. */
export function defaultCategories(): Record<Site, Category> {
  const out: Record<Site, Category> = {};
  const add = (sites: string[], category: Category): void => {
    for (const site of sites) out[site] = category;
  };
  add(WORK, 'Work');
  add(SOCIAL, 'Social');
  add(VIDEO, 'Video');
  add(SHOPPING, 'Shopping');
  add(NEWS, 'News');
  return out;
}

const BUILT_IN = defaultCategories();

/** The user's map wins over the built-in map; unknown sites are Other. */
export function categoryOf(site: Site, settingsCategories: Record<Site, Category>): Category {
  if (Object.hasOwn(settingsCategories, site)) return settingsCategories[site] ?? 'Other';
  return Object.hasOwn(BUILT_IN, site) ? (BUILT_IN[site] ?? 'Other') : 'Other';
}
