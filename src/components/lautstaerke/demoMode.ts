// Dev-only demo bypass for the noise-monitor page. When enabled it lets
// /crew/lautstaerke open WITHOUT a Directus crew session or the Neon device-list
// query, so the SurrealDB-on-OPFS + microphone showcase can be dogfooded on a
// bare `yarn dev` (no .env, no login). The live views run entirely client-side,
// so the only server dependencies are the auth gate and the device-list loader —
// both of which this flag stubs out.
//
// SAFETY: gated on BOTH `import.meta.env.DEV` (false in every production build,
// so the branch is dead-code-eliminated) AND an explicit opt-in env var. It can
// never be on in production even if the var is accidentally set there.
//
// Enable it by running the dev server with the flag, e.g.:
//   VITE_LAUTSTAERKE_DEMO=1 yarn dev
// then open http://localhost:3000/crew/lautstaerke
export const LAUTSTAERKE_DEMO =
  import.meta.env.DEV && !!import.meta.env.VITE_LAUTSTAERKE_DEMO;
