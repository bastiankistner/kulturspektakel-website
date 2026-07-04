import {defineConfig, type Plugin} from 'vite';
import {tanstackStart} from '@tanstack/react-start/plugin/vite';
import {nitroV2Plugin} from '@tanstack/nitro-v2-vite-plugin';
import viteReact from '@vitejs/plugin-react';

// The local SurrealDB storage option on /crew/lautstaerke runs the SurrealDB
// wasm engine, which uses OPFS SyncAccessHandles and SharedArrayBuffer — both
// require the page to be cross-origin isolated (COOP: same-origin + COEP:
// require-corp). These headers are SCOPED to the noise-monitor subtree so the
// rest of the marketing site (Google Maps, Spotify, other cross-origin embeds)
// is unaffected. In production Nitro's `routeRules` emit them (Vercel preset);
// in dev this plugin sets them, since Vite's `server.headers` is global.
const COI_PATH = '/crew/lautstaerke';
const COI_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

function crossOriginIsolationDev(): Plugin {
  return {
    name: 'lautstaerke-cross-origin-isolation-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.startsWith(COI_PATH)) {
          for (const [k, v] of Object.entries(COI_HEADERS)) res.setHeader(k, v);
        }
        next();
      });
    },
  };
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    crossOriginIsolationDev(),
    tanstackStart({
      // Tests are colocated with route files; don't treat them as routes.
      router: {
        routeFileIgnorePattern: '\\.(test|spec)\\.',
      },
    }),
    nitroV2Plugin({
      preset: 'vercel',
      // The /api/tasks/nuclino-update-message cron scans the whole Nuclino
      // workspace (~14 sequential paginated requests, ~7s) since the API has no
      // recency sort. That brushes Vercel's default function timeout and
      // intermittently 504s. Raise the ceiling (a max, billed by actual time).
      vercel: {
        functions: {
          maxDuration: 60,
        },
      },
      // Cross-origin isolation for the SurrealDB-on-OPFS storage option, scoped
      // to the noise-monitor subtree only (see COI_HEADERS above). The Vercel
      // preset translates these routeRules headers into the deploy's output
      // config, so they apply in production.
      routeRules: {
        [`${COI_PATH}/**`]: {headers: {...COI_HEADERS}},
      },
    }),
    viteReact(),
  ],
  ssr: {
    noExternal: ['@apollo/client', 'iban-ts'],
  },
  optimizeDeps: {
    // The SurrealDB wasm engine + its worker must not be pre-bundled (top-level
    // await, ~13MB .wasm). The SDK is excluded too: its `node`-condition export
    // points at a server bundle that esbuild's dep-optimizer chokes on, and it
    // is already ESM so pre-bundling buys nothing.
    exclude: ['@frachter-app/surrealdb-wasm', '@frachter-app/surrealdb'],
  },
  build: {
    sourcemap: true,
    // The custom SurrealDB worker uses top-level `await import(...)` for
    // provider-first ordering; esnext keeps top-level await in both the app and
    // worker chunks.
    target: 'esnext',
    rollupOptions: {
      // The Surrealist embed is an OPTIONAL, dynamically-imported dependency
      // (a pre-release in a separate fork repo that may not be installed). Mark
      // it external so the build doesn't fail resolving it when absent; the
      // SurrealistModal loads it at runtime and falls back gracefully if the
      // module isn't there.
      external: ['@frachter-app/surrealist'],
    },
  },
  worker: {
    format: 'es',
  },
  esbuild: {
    target: 'esnext',
  },
  server: {
    port: 3000,
    host: true,
    allowedHosts: ['daniels-mac-studio.local'],
  },
});
