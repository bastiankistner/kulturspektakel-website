import {useCallback, useEffect, useRef, useState} from 'react';
import type {Surreal} from '@frachter-app/surrealdb';
import {connect, type Connection} from './db';
import {ingest as ingestReading} from './store';
import {
  persistReadSource,
  persistWriteSink,
  readPersistedSource,
  readPersistedWriteSink,
} from './readSource';
import type {NoiseRecording} from '../../../proto/noise';
import type {
  StorageBackend,
  StorageSlice,
  SurrealStatus,
} from '../context';

/**
 * Owns the local SurrealDB-on-OPFS lifecycle for the noise monitor and exposes
 * the {@link StorageSlice} plus an `ingest` callback the layout wires into the
 * live MQTT/BLE stream.
 *
 * The opfs:// volume is opened LAZILY: nothing touches OPFS until the user turns
 * on Surreal writes or switches the read source to Surreal. Turning everything
 * back off disposes the connection (releasing the exclusive OPFS handle).
 */
export function useSurrealStorage(): {
  slice: StorageSlice;
  ingest: (device: string, decoded: NoiseRecording, receiveTime: number) => void;
} {
  // Both preferences persist to localStorage. Initialise to the SSR-safe
  // defaults ('neon' / false) — NOT the persisted values — so the first client
  // render matches the server-rendered HTML (localStorage doesn't exist during
  // SSR). The stored values are then adopted in a mount effect below. Reading
  // localStorage in the useState initialiser instead would render the persisted
  // choice on the client while the server rendered the default → hydration
  // mismatch (React discards and re-renders the subtree).
  const [readSource, setReadSourceState] = useState<StorageBackend>('neon');
  const setReadSource = useCallback((b: StorageBackend) => {
    setReadSourceState(b);
    persistReadSource(b);
  }, []);
  const [surrealWrite, setSurrealWriteState] = useState(false);
  const setSurrealWrite = useCallback((on: boolean) => {
    setSurrealWriteState(on);
    persistWriteSink(on);
  }, []);

  // Adopt the persisted preferences after hydration. Runs once on mount, after
  // the SSR-matched first paint, so it can't cause a hydration mismatch. Uses the
  // functional/plain setters (not the persisting ones) so restoring a value
  // doesn't re-write the same value back to localStorage.
  useEffect(() => {
    const storedSource = readPersistedSource();
    if (storedSource !== 'neon') setReadSourceState(storedSource);
    if (readPersistedWriteSink()) setSurrealWriteState(true);
    // Mount-only: intentionally no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [status, setStatus] = useState<SurrealStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<Surreal | null>(null);

  const connRef = useRef<Connection | null>(null);
  // Guards against overlapping connect() calls and against a resolved connect
  // landing after the component unmounted / Surreal was turned back off.
  const connectingRef = useRef(false);
  // The in-flight dispose(), if any. A new connect() must await this first:
  // dispose() releases the volume's EXCLUSIVE OPFS handle asynchronously, so
  // connecting before it settles would try to re-acquire a still-held handle and
  // stall until the connect timeout. Off→on toggles hit exactly this.
  const disposingRef = useRef<Promise<void> | null>(null);

  // Surreal is "wanted" whenever we read from it or mirror writes into it.
  const wantSurreal = surrealWrite || readSource === 'surreal';

  useEffect(() => {
    let cancelled = false;

    if (wantSurreal) {
      if (connRef.current || connectingRef.current) return;
      connectingRef.current = true;
      setStatus('connecting');
      setError(null);
      // Wait out any in-flight dispose so the previous worker has released the
      // exclusive OPFS handle before we try to re-acquire it.
      Promise.resolve(disposingRef.current)
        .then(() => connect())
        .then((conn) => {
          if (cancelled) {
            void conn.dispose();
            return;
          }
          connRef.current = conn;
          setDb(conn.db);
          setStatus('ready');
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        })
        .finally(() => {
          connectingRef.current = false;
        });
    } else if (connRef.current) {
      // No longer wanted → release the volume (and its exclusive OPFS handle).
      // Track the dispose so a subsequent connect awaits it (see disposingRef).
      const conn = connRef.current;
      connRef.current = null;
      setDb(null);
      setStatus('idle');
      setError(null);
      const p = conn.dispose().finally(() => {
        if (disposingRef.current === p) disposingRef.current = null;
      });
      disposingRef.current = p;
    }

    return () => {
      cancelled = true;
    };
  }, [wantSurreal]);

  // Tear down on unmount (layout leaves) so the handle is always released.
  useEffect(() => {
    return () => {
      const conn = connRef.current;
      connRef.current = null;
      if (conn) void conn.dispose();
    };
  }, []);

  // Mirror whenever writes are enabled OR we're reading from Surreal — reading
  // from an empty volume would show nothing, so the read implies capture.
  const writeActive = surrealWrite || readSource === 'surreal';

  const ingest = useCallback(
    (device: string, decoded: NoiseRecording, receiveTime: number) => {
      // Fire-and-forget: a failed local write must never disturb the live view.
      if (!writeActive) return;
      const conn = connRef.current;
      if (!conn) return;
      void ingestReading(conn.db, device, decoded, receiveTime).catch((e) => {
        console.error('[lautstärke] surreal ingest failed', e);
      });
    },
    [writeActive],
  );

  const slice: StorageSlice = {
    readSource,
    setReadSource,
    surrealWrite,
    setSurrealWrite,
    status,
    error,
    db,
  };

  return {slice, ingest};
}
