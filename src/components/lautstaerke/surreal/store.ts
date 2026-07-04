// Domain store over the local SurrealDB-on-OPFS volume: the SurrealDB analogue
// of the server-side Neon path (src/server/noise.ts ingest +
// src/server/noiseHistory.server.ts aggregation), but running entirely in the
// browser against `opfs://kult-lautstaerke`.
//
// Data model — one `reading` row per second, with an ARRAY record id
// `reading:[$device, $ts_ms]`. Array ids sort naturally, so a per-day history
// query is a record-range scan (`reading:[dev, start]..[dev, end]`) instead of
// a table scan — the idiomatic SurrealDB time-series pattern. Values are stored
// in the SAME wire encoding as NoiseLog ((dB - 20) * 2, one uint8 per band), so
// the aggregation math matches the Neon SQL exactly.
import {RecordId, Table, type Surreal} from '@frachter-app/surrealdb';
import type {NoiseRecording} from '../../../proto/noise';
import {HISTORY_SERIES, type HistoryRow} from '../context';

const TABLE = 'reading';

/** A single per-second measurement as stored (raw wire encoding, not decoded). */
type ReadingRow = {
  device: string;
  ts: number; // epoch ms
  seqNo: number;
  bands: number[];
  laeq_1s: number;
  lceq_1s: number;
  lafmax_1s: number;
  lcfmax_1s: number;
  lcpeak_1s: number;
  [key: string]: unknown;
};

/** Notification payload shape from a `reading` live query. */
export interface LiveReading {
  device: string;
  ts: number;
  bands: number[];
  laeq_1s: number;
  lceq_1s: number;
  lafmax_1s: number;
  lcfmax_1s: number;
  lcpeak_1s: number;
}

/**
 * Persist every record of a decoded `NoiseRecording` frame into SurrealDB, one
 * `reading` row per record. Mirrors handleNoiseLog: the first record is the
 * reference time and each later record's timestamp is offset by its `seqNo`
 * distance (gap-aware), so re-ingesting a batch is idempotent (same ids → UPSERT
 * overwrites rather than duplicating).
 *
 * `receiveTime` is the browser receipt time (epoch ms) used as the reference for
 * the first record — the live MQTT/BLE stream carries no device clock here.
 */
export async function ingest(
  db: Surreal,
  device: string,
  decoded: NoiseRecording,
  receiveTime: number,
): Promise<void> {
  const records = decoded.records;
  if (records.length === 0) return;
  const firstSeqNo = records[0].seqNo;

  // UPSERT so a re-sent record with the same id overwrites instead of erroring
  // on a duplicate id (the array id is deterministic per device+timestamp).
  await Promise.all(
    records.map((r) => {
      const ts = receiveTime + (r.seqNo - firstSeqNo) * 1000;
      const row: ReadingRow = {
        device,
        ts,
        seqNo: r.seqNo,
        bands: Array.from(r.bands),
        laeq_1s: r.laeq1s,
        lceq_1s: r.lceq1s,
        lafmax_1s: r.lafmax1s,
        lcfmax_1s: r.lcfmax1s,
        lcpeak_1s: r.lcpeak1s,
      };
      return db.upsert(new RecordId(TABLE, [device, ts])).content(row);
    }),
  );
}

/**
 * Subscribe to live `reading` inserts for a single device. Returns an async
 * unsubscribe function.
 *
 * `db.live(Table)` subscribes to the whole table (SurrealDB live subscriptions
 * are table-scoped; there is no WHERE), so we filter by device in the handler.
 * The table is defined first so the subscription has a table to attach to
 * (subscribing to a non-existent table yields no notifications).
 */
export async function liveSubscribe(
  db: Surreal,
  device: string,
  onReading: (r: LiveReading) => void,
): Promise<() => Promise<void>> {
  await db.query('DEFINE TABLE IF NOT EXISTS reading SCHEMALESS;');

  const sub = await db.live<ReadingRow>(new Table(TABLE));

  const unsubscribe = sub.subscribe((message) => {
    if (message.action !== 'CREATE' && message.action !== 'UPDATE') return;
    const row = message.value as unknown as ReadingRow;
    if (row.device !== device) return;
    onReading({
      device: row.device,
      ts: row.ts,
      bands: row.bands,
      laeq_1s: row.laeq_1s,
      lceq_1s: row.lceq_1s,
      lafmax_1s: row.lafmax_1s,
      lcfmax_1s: row.lcfmax_1s,
      lcpeak_1s: row.lcpeak_1s,
    });
  });

  return async () => {
    unsubscribe();
    await sub.kill();
  };
}

/**
 * Per-minute aggregate of one device's readings over a local-day range, computed
 * in SurrealQL. Mirrors noiseHistory() (noiseHistory.server.ts): the stored ints
 * are (dB - 20) * 2, so dB = 20 + val/2 and energy = 10^(dB/10). Leq is the
 * count-weighted mean power back to dB; max/peak are per-minute maxima decoded to
 * dB. The 5m/30m windows are approximated by re-aggregating the per-minute
 * buckets client-side (SurrealDB has no RANGE window functions), so missing
 * minutes simply contribute nothing (gap-tolerant), same as the SQL.
 *
 * `startMs`/`endMs` are epoch-ms bounds of the local day (half-open [start,end)).
 */
export async function history(
  db: Surreal,
  device: string,
  startMs: number,
  endMs: number,
): Promise<HistoryRow[]> {
  // Record-range scan on the array id (no table scan). SurrealDB's GROUP BY +
  // aggregate functions do the per-minute rollup; time::floor buckets ts to the
  // minute. energy = 10^((20 + val/2)/10), summed then divided by count → dB.
  const [rows] = await db.query<
    [
      Array<{
        minute: number; // epoch ms of the minute bucket
        a_energy: number;
        c_energy: number;
        n: number;
        a_fmax: number;
        c_fmax: number;
        c_peak: number;
      }>,
    ]
  >(
    // `ts` is epoch MILLISECONDS. A bare `<datetime>int` cast reads the int as
    // SECONDS (SurrealDB semantics), so we must convert via time::from_millis;
    // time::floor(_, 1m) then buckets to the minute, and time::unix(_)*1000
    // brings the bucket back to epoch ms. (time::from::millis was renamed to the
    // underscore form time::from_millis in SurrealDB 3.0.)
    `SELECT
        (time::unix(time::floor(time::from_millis(ts), 1m)) * 1000) AS minute,
        math::sum(math::pow(10, (20 + laeq_1s / 2.0) / 10)) AS a_energy,
        math::sum(math::pow(10, (20 + lceq_1s / 2.0) / 10)) AS c_energy,
        count() AS n,
        math::max(lafmax_1s) AS a_fmax,
        math::max(lcfmax_1s) AS c_fmax,
        math::max(lcpeak_1s) AS c_peak
      FROM ${rangeFrom(device, startMs, endMs)}
      GROUP BY minute
      ORDER BY minute`,
  );

  const perMinute = (rows ?? []).map((r) => ({
    minute: r.minute,
    aEnergy: r.a_energy,
    cEnergy: r.c_energy,
    n: r.n,
    lafmax: 20 + r.a_fmax / 2,
    lcfmax: 20 + r.c_fmax / 2,
    lcpeak: 20 + r.c_peak / 2,
  }));

  return perMinute.map((m, i) => {
    const win = (minutes: number) => windowedLeq(perMinute, i, minutes);
    return {
      minute_epoch: m.minute / 1000,
      laeq_1m: energyToDb(m.aEnergy, m.n),
      laeq_5m: win(5).a,
      laeq_30m: win(30).a,
      lafmax: m.lafmax,
      lceq_1m: energyToDb(m.cEnergy, m.n),
      lceq_5m: win(5).c,
      lceq_30m: win(30).c,
      lcfmax: m.lcfmax,
      lcpeak: m.lcpeak,
    } satisfies HistoryRow;
  });
}

/** The up-to-10 most recent local days (yyyy-mm-dd) that have data for a device. */
export async function days(
  db: Surreal,
  device: string,
  timeZone: string,
): Promise<string[]> {
  // Whole-device range scan; bucket each ts to a local-day string client-side
  // (SurrealDB has no tz-aware date_trunc), dedupe, newest first, cap at 10.
  const [rows] = await db.query<[Array<{ts: number}>]>(
    `SELECT VALUE ts FROM ${rangeFrom(device)} ORDER BY ts DESC`,
  );
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const seen = new Set<string>();
  const out: string[] = [];
  for (const {ts} of rows ?? []) {
    const day = fmt.format(new Date(ts)); // en-CA → yyyy-mm-dd
    if (!seen.has(day)) {
      seen.add(day);
      out.push(day);
      if (out.length >= 10) break;
    }
  }
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * A record-range target string for `device`, optionally bounded to
 * [startMs, endMs). Array-id ranges are half-open on the upper bound in SurrealQL
 * (`a..b`), matching the SQL `< end`. Ids are literal arrays; the values are
 * numbers/strings so they are safe to inline (device comes from our own device
 * list, ts are numbers).
 */
function rangeFrom(device: string, startMs?: number, endMs?: number): string {
  const dev = JSON.stringify(device);
  if (startMs === undefined || endMs === undefined) {
    // Whole device: [dev, NONE]..[dev, ..] spans every ts for the device.
    return `${TABLE}:[${dev}, NONE]..[${dev}, ..]`;
  }
  return `${TABLE}:[${dev}, ${startMs}]..[${dev}, ${endMs}]`;
}

// Count-weighted mean power (energy/n) back to dB. Returns NaN if n===0 (uPlot
// renders NaN as a gap, same as the Neon path's NULL). In practice n is always
// >0 here: per-minute buckets only exist when they have rows, and windowedLeq
// always includes the current bucket — so the NaN branch is unreachable, it's
// just a defensive guard against a divide-by-zero.
function energyToDb(energy: number, n: number): number {
  return n > 0 ? 10 * Math.log10(energy / n) : NaN;
}

/**
 * Trailing-window Leq over the per-minute buckets: sum energy and counts across
 * the `minutes` buckets ending at index `i` (by minute timestamp, gap-tolerant —
 * absent minutes just aren't in the array), back to dB for both weightings.
 */
function windowedLeq(
  buckets: Array<{minute: number; aEnergy: number; cEnergy: number; n: number}>,
  i: number,
  minutes: number,
): {a: number; c: number} {
  const cutoff = buckets[i].minute - (minutes - 1) * 60_000;
  let aE = 0;
  let cE = 0;
  let n = 0;
  for (let j = i; j >= 0 && buckets[j].minute >= cutoff; j--) {
    aE += buckets[j].aEnergy;
    cE += buckets[j].cEnergy;
    n += buckets[j].n;
  }
  return {a: energyToDb(aE, n), c: energyToDb(cE, n)};
}

// Re-export the col mapping so the history route can project rows the same way
// the Neon path does (rowsToAligned).
export {HISTORY_SERIES};
export type {HistoryRow};
