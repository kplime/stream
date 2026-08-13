import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // maplibre-gl resolves its Web Worker at runtime via a dynamic
    // `new URL(`./${file}`, import.meta.url)` (not a static literal), so
    // Rollup can't detect it as a build dependency and never emits it —
    // production builds 404 (SPA-fallback to index.html) on
    // /assets/maplibre-gl-worker.mjs and the map silently never finishes
    // loading. Copy it next to the bundle by hand so that runtime URL
    // resolves. Matches whatever maplibre-gl version is installed.
    viteStaticCopy({
      targets: [
        // the worker's own `import ... from "./maplibre-gl-shared.mjs"` is
        // also an unbundled relative import, so its sibling has to ship too.
        {
          src: 'node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs',
          dest: 'assets',
          rename: { stripBase: true, name: 'maplibre-gl-worker.mjs' },
        },
        {
          src: 'node_modules/maplibre-gl/dist/maplibre-gl-shared.mjs',
          dest: 'assets',
          rename: { stripBase: true, name: 'maplibre-gl-shared.mjs' },
        },
      ],
    }),
  ],
  // maplibre-gl's worker resolution above also affects dev: pre-bundling
  // rewrites its module URL, so exclude it to keep the relative worker path
  // intact when served straight from node_modules.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
