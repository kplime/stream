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
  build: {
    // 기본 타깃으로 두면 미니파이어가 미디어쿼리를 범위 문법으로 축약한다
    // (`@media (max-width: 768px)` → `@media (width <= 768px)`).
    // 그 문법은 Safari 16.4 / Chrome 104 미만이 파싱하지 못해 해당 블록을
    // 통째로 버리고, 결과적으로 구형 폰에서 반응형이 하나도 적용되지 않는다.
    // 대시보드를 현장에서 아무 폰으로나 열어볼 수 있어야 하므로 타깃을 낮춰
    // 레거시 문법으로 출력되게 한다.
    cssTarget: ['chrome87', 'safari13.1', 'firefox78', 'edge88'],
  },
  // maplibre-gl's worker resolution above also affects dev: pre-bundling
  // rewrites its module URL, so exclude it to keep the relative worker path
  // intact when served straight from node_modules.
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
})
