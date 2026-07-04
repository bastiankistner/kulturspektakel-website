// Connection layer for the local SurrealDB-on-OPFS volume backing the noise
// monitor's "SurrealDB" storage option.
//
// The `opfs` scheme is bound to a COORDINATED engine (multi-tab): the first tab
// to open the volume wins a Web Lock and owns the single real engine (a
// provider-first worker); other tabs on the same volume become followers that
// proxy CBOR RPC to the leader over a BroadcastChannel. A lone tab behaves as a
// leader with no followers. This is required because OPFS allows only one
// exclusive SyncAccessHandle per file per origin — without coordination a second
// tab would deadlock on connect.
import {WebAssemblyEngine, WorkerEngineBroker} from '@frachter-app/surrealdb-wasm';
import {Surreal} from '@frachter-app/surrealdb';
import {
  createCoordinatedOpfsEngines,
  type WebAssemblyEngineCtor,
} from '@frachter-app/surreal-engine-coordinator';

/** OPFS volume name → connect URL `opfs://kult-lautstaerke`. */
export const VOLUME = 'kult-lautstaerke';
export const CONNECT_URL = `opfs://${VOLUME}`;
export const NAMESPACE = 'noise';
export const DATABASE = 'noise';

/**
 * How long to wait for `db.connect()` before treating it as stuck. The opfs://
 * volume holds an exclusive OPFS handle per origin; a coordination or handoff
 * hiccup could otherwise stall the connect indefinitely with no error.
 */
const CONNECT_TIMEOUT_MS = 15_000;

/** A connected Surreal instance plus a teardown. */
export interface Connection {
  db: Surreal;
  dispose(): Promise<void>;
}

function createCoordinatedEngines(onLeaderLost?: () => void) {
  return createCoordinatedOpfsEngines({
    // Cast across the package boundary: @frachter-app/surrealdb-wasm bundles its
    // own copy of the SDK's branded types, so its WebAssemblyEngine is nominally
    // (not structurally) distinct from the coordinator's SDK-typed ctor. The
    // runtime classes are identical.
    WebAssemblyEngine: WebAssemblyEngine as unknown as WebAssemblyEngineCtor,
    // Called ONLY on the tab that wins the lock (the leader). WorkerEngineBroker
    // reads `createWorker` from the connect options (engineOptions below), which
    // the coordinator forwards into the leader broker's connect().
    createLeaderBroker: () => new WorkerEngineBroker(),
    engineOptions: {
      // Provider-first worker: installs the opfs-kv provider before booting the
      // wasm engine agent (see ./worker.ts).
      createWorker: () =>
        new Worker(new URL('./worker.ts', import.meta.url), {type: 'module'}),
    },
    volumeFromUrl: (url) => url.host,
    onLeaderLost,
  });
}

/**
 * Connect to the coordinated `opfs://` volume, select the namespace/database,
 * and return it with a `dispose()`. Rejects if the connect does not complete
 * within {@link CONNECT_TIMEOUT_MS}.
 *
 * `onLeaderLost` fires if this tab was a follower and its leader vanished; the
 * coordinator's default is `location.reload()`, but the caller can override to
 * re-connect in place.
 */
export async function connect(onLeaderLost?: () => void): Promise<Connection> {
  const db = new Surreal({engines: createCoordinatedEngines(onLeaderLost)});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `connect("${CONNECT_URL}") timed out after ${CONNECT_TIMEOUT_MS}ms — ` +
            `the volume may be stuck open in another tab (OPFS handles are ` +
            `exclusive per origin).`,
        ),
      );
    }, CONNECT_TIMEOUT_MS);
  });

  try {
    await Promise.race([
      (async () => {
        await db.connect(CONNECT_URL);
        await db.use({namespace: NAMESPACE, database: DATABASE});
      })(),
      timeout,
    ]);
  } catch (err) {
    try {
      await db.close();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }

  return {
    db,
    async dispose() {
      try {
        await db.close();
      } catch {
        /* ignore */
      }
    },
  };
}
