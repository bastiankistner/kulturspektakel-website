// Stage the Surrealist embed's static assets into public/ so the iframe can be
// served same-origin (the <Surrealist baseUrl="/surrealist-embed"> default).
//
// The assets ship inside @frachter-app/surrealist/dist/embed-assets (~66 MB incl.
// wasm) — far too large to commit, so public/surrealist-embed is gitignored and
// (re)created from node_modules here. Runs on postinstall and before dev/build.
// No-op (with a warning) if the optional package isn't installed, so an install
// without GitHub Packages auth still succeeds.
import {cpSync, existsSync, rmSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(
  root,
  'node_modules/@frachter-app/surrealist/dist/embed-assets',
);
const dest = resolve(root, 'public/surrealist-embed');

if (!existsSync(src)) {
  console.warn(
    '[surrealist-embed] @frachter-app/surrealist not installed — skipping asset copy. ' +
      'The Surrealist modal will show its "not installed" fallback.',
  );
  process.exit(0);
}

rmSync(dest, {recursive: true, force: true});
cpSync(src, dest, {recursive: true});
console.log(`[surrealist-embed] copied embed assets → ${dest}`);
