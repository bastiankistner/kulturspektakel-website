// The wasm engine agent entry has no bundled types; it self-runs on import and
// is only ever side-effect-imported inside the worker.
declare module '@frachter-app/surrealdb-wasm/worker';
