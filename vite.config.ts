import {defineConfig, type Plugin} from 'vite';
import {tanstackStart} from '@tanstack/react-start/plugin/vite';
import {nitroV2Plugin} from '@tanstack/nitro-v2-vite-plugin';
import viteReact from '@vitejs/plugin-react';

// The local SurrealDB storage option on /crew/lautstaerke runs the SurrealDB
// wasm engine, which uses OPFS SyncAccessHandles and SharedArrayBuffer — both
// require the page to be cross-origin isolated (COOP: same-origin + COEP:
// require-corp). COOP/COEP are SCOPED to the noise-monitor subtree so the rest
// of the marketing site (Google Maps, Spotify, other cross-origin embeds) is
// unaffected. In production Nitro's `routeRules` emit them (Vercel preset); in
// dev this plugin sets them, since Vite's `server.headers` is global.
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
        // Cross-origin isolation + the SurrealDB worker interact badly with Vite's
        // dev server unless we set the right headers on the RIGHT responses:
        //
        //  - CORP on every response: under COEP: require-corp, every subresource
        //    the isolated page and its worker load (the /node_modules/ modules,
        //    the wasm) must carry Cross-Origin-Resource-Policy or the browser
        //    blocks it. Vite doesn't add it, so we do — same-origin, inert for
        //    the rest of the site.
        //  - COEP on the WORKER SCRIPT response: a module worker spawned from an
        //    isolated page must itself be COEP-compatible, or the browser refuses
        //    to instantiate it AT ALL (empty error, script never even fetched) —
        //    which is what made db.connect("opfs://…") hang to its timeout. The
        //    worker entry is served from /src/…, so scope COEP to same-origin
        //    module/script requests (not the /crew/lautstaerke *page* only).
        //  - COEP on the SURREALIST EMBED HTML: the Surrealist IDE renders in an
        //    <iframe src="/surrealist-embed/mini/run/index.html">. An iframe
        //    embedded in a COEP: require-corp page must ITSELF be served with a
        //    compatible COEP, even same-origin — otherwise Chrome blocks the
        //    frame load (ERR_BLOCKED_BY_RESPONSE.NotSameOriginAfterDefaulted…),
        //    which the browser renders as "localhost refused to connect". So the
        //    embed's document (and its own module graph, already covered above)
        //    must carry COEP too.
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        const url = req.url ?? '';
        const isModuleRequest =
          url.startsWith('/src/') ||
          url.startsWith('/node_modules/') ||
          url.startsWith('/@');
        const isEmbedRequest = url.startsWith('/surrealist-embed/');
        if (url.startsWith(COI_PATH) || isModuleRequest || isEmbedRequest) {
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
      // Cross-origin isolation for the SurrealDB-on-OPFS storage option. The
      // Vercel preset translates these routeRules headers into the deploy's
      // output config, so they apply in production.
      //
      //  - COOP/COEP are SCOPED to the noise-monitor page subtree (see
      //    COI_HEADERS) so the rest of the marketing site is unaffected.
      //  - CORP is applied to the ASSET paths too: under COEP require-corp the
      //    isolated page's SurrealDB worker + its wasm/JS chunks (served from
      //    /assets and /surrealist-embed) must carry Cross-Origin-Resource-Policy
      //    — same-origin does NOT exempt them. Without this, prod hits the same
      //    worker-boot hang as dev (opfs:// connect times out). See
      //    https://github.com/frachter-app/opfs-vfs/issues/165.
      //  - COOP/COEP are applied to /surrealist-embed/** as well (not just CORP):
      //    the Surrealist IDE is framed from the COEP: require-corp noise page, so
      //    the embed's HTML document must itself be served with a compatible COEP
      //    or Chrome refuses to load the iframe ("refused to connect"). It also
      //    needs COEP to be cross-origin isolated in its own right, since it runs
      //    the SurrealDB wasm engine + worker.
      routeRules: {
        [`${COI_PATH}/**`]: {headers: {...COI_HEADERS}},
        '/assets/**': {headers: {'Cross-Origin-Resource-Policy': 'cross-origin'}},
        '/surrealist-embed/**': {
          headers: {
            ...COI_HEADERS,
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        },
      },
    }),
    viteReact(),
  ],
  ssr: {
    noExternal: ['@apollo/client', 'iban-ts'],
  },
  optimizeDeps: {
    // Keep the whole @frachter-app SurrealDB stack out of Vite's dep-optimizer.
    // The wasm engine + its worker must not be pre-bundled (top-level await,
    // ~13MB .wasm); the SDK's `node`-condition export points at a server bundle
    // that esbuild's optimizer chokes on. Crucially, surreal-opfs-kv and
    // surreal-engine-coordinator must ALSO be excluded: when installed from the
    // registry (not workspace source) Vite tries to pre-bundle them, and they
    // transitively import the excluded wasm package — producing a broken
    // `.vite/deps/@frachter-app_surrealdb-wasm.js?v=` reference that makes the
    // provider-first worker fail to boot, so `db.connect("opfs://…")` hangs until
    // the 15s timeout. Excluding them keeps the import graph intact (they're ESM,
    // so pre-bundling buys nothing anyway).
    exclude: [
      '@frachter-app/surrealdb-wasm',
      '@frachter-app/surrealdb',
      '@frachter-app/surreal-opfs-kv',
      '@frachter-app/surreal-engine-coordinator',
    ],
  },
  build: {
    sourcemap: true,
    // The custom SurrealDB worker uses top-level `await import(...)` for
    // provider-first ordering; esnext keeps top-level await in both the app and
    // worker chunks.
    target: 'esnext',
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
