import type {StorageBackend} from '../context';

// Persisted read-source preference. Kept in its own dependency-free module so
// both the SurrealDB hook (client) and the history route's loader (which also
// runs server-side) can import it WITHOUT pulling in the wasm SDK / Web Audio /
// worker code that useSurrealStorage transitively imports.
export const READ_SOURCE_KEY = 'lautstaerke.readSource';

/** The persisted read source, or 'neon' when unset / not in a browser (SSR). */
export function readPersistedSource(): StorageBackend {
  if (typeof localStorage === 'undefined') return 'neon';
  return localStorage.getItem(READ_SOURCE_KEY) === 'surreal' ? 'surreal' : 'neon';
}

/** Persist the read source (no-op outside a browser). */
export function persistReadSource(b: StorageBackend): void {
  if (typeof localStorage !== 'undefined') localStorage.setItem(READ_SOURCE_KEY, b);
}
