import {useEffect, useRef} from 'react';
import type {Surreal} from '@frachter-app/surrealdb';
import {liveSubscribe, type LiveReading} from './store';
import {
  SERIES,
  WINDOW_S,
  decodeDb,
  type DeviceBuffer,
} from '../context';

// A uPlot-shaped rolling buffer for one device's live SERIES, but fed by a
// SurrealDB `LIVE SELECT` on the `reading` table instead of the in-memory
// MQTT/BLE buffer. This is the "reactive from the database" path: when the read
// source is SurrealDB, the live chart re-renders off the DB's own change feed.
//
// The buffer layout matches ctx.deviceData ([times[], ...oneColumnPerSeries[]])
// so the live route can drop it into the same chart with no other changes. Live
// notifications only carry per-second values (laeq_1s etc.), so the 5m/30m
// SERIES columns — which come from batch fields on the frame, absent here — are
// filled with null (the chart simply shows no line for them live, same as before
// a device's ring buffers fill).
export function useSurrealLiveBuffer(
  db: Surreal | null,
  device: string,
  enabled: boolean,
): {current: DeviceBuffer} {
  const bufRef = useRef<DeviceBuffer>([[], ...SERIES.map(() => [])]);

  // Map a live reading to the SERIES column values, in SERIES order. Only the
  // per-second series resolve; windowed (5m/30m) series are null live.
  useEffect(() => {
    if (!enabled || !db) {
      // Reset so a stale buffer isn't shown after switching away.
      bufRef.current = [[], ...SERIES.map(() => [])];
      return;
    }

    // Reset on (re)subscribe so we don't blend two devices' streams.
    bufRef.current = [[], ...SERIES.map(() => [])];

    let unsub: (() => Promise<void>) | null = null;
    let cancelled = false;

    void liveSubscribe(db, device, (r: LiveReading) => {
      const buf = bufRef.current;
      buf[0].push(r.ts / 1000);
      SERIES.forEach((s, j) => buf[j + 1].push(liveColumn(s, r)));
    })
      .then((fn) => {
        if (cancelled) void fn();
        else unsub = fn;
      })
      .catch((e: unknown) => {
        console.error('[lautstärke] surreal live subscribe failed', e);
      });

    // Trim to the rolling window on the same 1 Hz cadence as the layout does for
    // the MQTT buffer, so the chart's x-window stays bounded.
    const trim = setInterval(() => {
      const buf = bufRef.current;
      const minTs = Date.now() / 1000 - WINDOW_S;
      let cutoff = 0;
      while (cutoff < buf[0].length && (buf[0][cutoff] as number) < minTs) {
        cutoff++;
      }
      if (cutoff > 0) for (const col of buf) col.splice(0, cutoff);
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(trim);
      if (unsub) void unsub();
    };
  }, [db, device, enabled]);

  return bufRef;
}

// The per-second SERIES resolve from a live reading; windowed series (5m/30m,
// which are batch aggregates not present on a live frame) are null.
function liveColumn(
  s: (typeof SERIES)[number],
  r: LiveReading,
): number | null {
  switch (s.label) {
    case 'LAeq,1s':
      return decodeDb(r.laeq_1s);
    case 'LCeq,1s':
      return decodeDb(r.lceq_1s);
    case 'LAFmax':
      return decodeDb(r.lafmax_1s);
    case 'LCFmax':
      return decodeDb(r.lcfmax_1s);
    case 'LCpeak':
      return decodeDb(r.lcpeak_1s);
    default:
      // 5m / 30m windowed series — not available on a live frame.
      return null;
  }
}
