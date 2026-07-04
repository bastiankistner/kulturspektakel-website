import {subMinutes} from 'date-fns';
import {tzOffset} from '@date-fns/tz';
import {HISTORY_SERIES, type HistoryRow} from './context';
import {timeZone} from '../../utils/dateUtils';

// Pure history helpers shared by the server-side Neon path
// (src/server/noiseHistory.server.ts) and the client-side SurrealDB path
// (src/components/lautstaerke/surreal/store.ts). Kept free of any server-only
// import (no Prisma) so it is safe to bundle into the browser.

// A local day runs from local 00:00 to the next local 00:00; convert each
// boundary with that date's timeZone offset so the range stays correct across
// DST transitions. `measuredAt`/`ts` are stored as UTC instants.
export function localDayRange(date: string): {start: Date; end: Date} {
  const [y, m, d] = date.split('-').map(Number);
  const startUtc = new Date(Date.UTC(y, m - 1, d));
  const endUtc = new Date(Date.UTC(y, m - 1, d + 1));
  return {
    start: subMinutes(startUtc, tzOffset(timeZone, startUtc)),
    end: subMinutes(endUtc, tzOffset(timeZone, endUtc)),
  };
}

// Project per-minute aggregate rows into the [x, ...columns] layout uPlot wants,
// with one column per HISTORY_SERIES entry in order. Only minutes that had data
// are present, so gaps are rendered by NoiseTimeChart's gap refiner. Returned as
// plain number[][]; the view casts it to uPlot.AlignedData at the chart edge.
export function rowsToAligned(rows: HistoryRow[]): number[][] {
  const xs = rows.map((r) => r.minute_epoch);
  const cols = HISTORY_SERIES.map((s) => rows.map((r) => r[s.col]));
  return [xs, ...cols];
}
