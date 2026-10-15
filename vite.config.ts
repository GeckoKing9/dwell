import { defineConfig } from 'vite';
import { crx, type ManifestV3Export } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };

export default defineConfig({
  plugins: [
    crx({
      manifest: manifest as ManifestV3Export,
      contentScripts: { standaloneFiles: ['src/content/guard.ts', 'src/content/media.ts', 'src/content/instagram-router.ts'] },
    }),
  ],
  oxc: {
    jsx: { runtime: 'automatic', importSource: 'preact' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: { polyfill: false },
    rolldownOptions: {
      input: {
        dashboard: 'src/dashboard/index.html',
      },
    },
  },
});
