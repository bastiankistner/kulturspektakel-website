// Custom SurrealDB engine worker for the `opfs://` scheme.
//
// ORDER IS CRITICAL:
//   1. installOpfsKvProvider() installs the opfs-kv bridge on THIS worker's
//      `self`, so the Rust engine's kv-opfs backend can resolve it.
//   2. `await import("@frachter-app/surrealdb-wasm/worker")` boots the engine
//      agent. The stock agent self-runs on import (adds a `message` listener +
//      posts READY), so it MUST be imported only AFTER the provider exists.
//
// OPFS sync access handles require a Worker context; this worker provides
// exactly that, co-locating the opfs provider and the wasm engine in one thread.
import {installOpfsKvProvider} from '@frachter-app/surreal-opfs-kv';

installOpfsKvProvider();

await import('@frachter-app/surrealdb-wasm/worker');
