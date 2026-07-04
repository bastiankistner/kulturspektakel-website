import {useCallback, useEffect, useRef, useState} from 'react';
import type {Surreal} from '@frachter-app/surrealdb';
import {connect, type Connection} from './db';
import {ingest as ingestReading} from './store';
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
  const [readSource, setReadSource] = useState<StorageBackend>('neon');
  const [surrealWrite, setSurrealWrite] = useState(false);
  const [status, setStatus] = useState<SurrealStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<Surreal | null>(null);

  const connRef = useRef<Connection | null>(null);
  // Guards against overlapping connect() calls and against a resolved connect
  // landing after the component unmounted / Surreal was turned back off.
  const connectingRef = useRef(false);

  // Surreal is "wanted" whenever we read from it or mirror writes into it.
  const wantSurreal = surrealWrite || readSource === 'surreal';

  useEffect(() => {
    let cancelled = false;

    if (wantSurreal) {
      if (connRef.current || connectingRef.current) return;
      connectingRef.current = true;
      setStatus('connecting');
      setError(null);
      connect()
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
      const conn = connRef.current;
      connRef.current = null;
      setDb(null);
      setStatus('idle');
      setError(null);
      void conn.dispose();
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
