import {prismaClient} from './prismaClient.server';
import {
  type DeviceLocationRecord,
  type HistoryRow,
} from '../components/lautstaerke/context';
import {timeZone} from '../utils/dateUtils';
// localDayRange + rowsToAligned are pure (no Prisma) and shared with the
// client-side SurrealDB history path, so they live in a client-safe module and
// are re-exported here to keep this module's public API stable.
import {localDayRange, rowsToAligned} from '../components/lautstaerke/noiseHistory.shared';

export {localDayRange, rowsToAligned};

// Aggregate NoiseLog (one row per second) into per-minute buckets for one
// device and one local day, entirely in SQL. Stored ints are encoded as
// (dB - 20) * 2, so dB = 20 + val/2 and energy = 10^(dB/10).
//
//  - Leq,1m: count-weighted mean power of the second-level Leq, back to dB.
//  - Leq,5m / Leq,30m: same, but over a time-RANGE window so missing minutes
//    simply contribute nothing (gap-tolerant) rather than skewing the span.
//  - max/peak: per-minute MAX, decoded to dB.
//
// The WHERE clause is a single range scan on the @@unique([deviceId, measuredAt])
// index (~86k rows/day → 1440 minute groups), so this stays cheap.
export async function noiseHistory(
  deviceId: string,
  date: string,
): Promise<HistoryRow[]> {
  const {start, end} = localDayRange(date);
  return prismaClient.$queryRaw<HistoryRow[]>`
    WITH per_min AS (
      SELECT
        date_trunc('minute', "measuredAt") AS minute,
        sum(power(10, (20 + laeq_1s / 2.0) / 10))::float8 AS a_energy,
        sum(power(10, (20 + lceq_1s / 2.0) / 10))::float8 AS c_energy,
        count(*)::float8 AS n,
        max(lafmax_1s) AS a_fmax,
        max(lcfmax_1s) AS c_fmax,
        max(lcpeak_1s) AS c_peak
      FROM "NoiseLog"
      WHERE "deviceId" = ${deviceId}
        AND "measuredAt" >= ${start}
        AND "measuredAt" < ${end}
      GROUP BY 1
    ), windowed AS (
      SELECT
        minute,
        10 * log(a_energy / n) AS laeq_1m,
        10 * log(c_energy / n) AS lceq_1m,
        10 * log(sum(a_energy) OVER w5 / NULLIF(sum(n) OVER w5, 0)) AS laeq_5m,
        10 * log(sum(c_energy) OVER w5 / NULLIF(sum(n) OVER w5, 0)) AS lceq_5m,
        10 * log(sum(a_energy) OVER w30 / NULLIF(sum(n) OVER w30, 0)) AS laeq_30m,
        10 * log(sum(c_energy) OVER w30 / NULLIF(sum(n) OVER w30, 0)) AS lceq_30m,
        20 + a_fmax / 2.0 AS lafmax,
        20 + c_fmax / 2.0 AS lcfmax,
        20 + c_peak / 2.0 AS lcpeak
      FROM per_min
      WINDOW
        w5 AS (ORDER BY minute RANGE BETWEEN INTERVAL '4 minutes' PRECEDING AND CURRENT ROW),
        w30 AS (ORDER BY minute RANGE BETWEEN INTERVAL '29 minutes' PRECEDING AND CURRENT ROW)
    )
    SELECT
      extract(epoch FROM minute)::float8 AS minute_epoch,
      laeq_1m::float8, laeq_5m::float8, laeq_30m::float8, lafmax::float8,
      lceq_1m::float8, lceq_5m::float8, lceq_30m::float8,
      lcfmax::float8, lcpeak::float8
    FROM windowed
    ORDER BY minute
  `;
}

// The up-to-10 most recent local-timezone days that have any data for a device,
// as 'yyyy-mm-dd' strings (newest first), for the day picker. "Has data" is
// evaluated in `timeZone`: measuredAt is stored as a UTC instant, so we
// reinterpret it as UTC then shift to `timeZone` before truncating to a day.
export async function noiseDays(deviceId: string): Promise<string[]> {
  const rows = await prismaClient.$queryRaw<{date: string}[]>`
    SELECT to_char(day, 'YYYY-MM-DD') AS date
    FROM (
      SELECT DISTINCT
        date_trunc('day', ("measuredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}) AS day
      FROM "NoiseLog"
      WHERE "deviceId" = ${deviceId}
    ) d
    ORDER BY day DESC
    LIMIT 10
  `;
  return rows.map((r) => r.date);
}

// A device's full location history (few rows), oldest first. The label shown for
// a given day is resolved client-side from this (see resolveLocation) since a
// device can be relocated over time.
export async function deviceLocations(
  deviceId: string,
): Promise<DeviceLocationRecord[]> {
  const rows = await prismaClient.deviceLocation.findMany({
    where: {deviceId},
    orderBy: {createdAt: 'asc'},
    select: {locationName: true, createdAt: true},
  });
  return rows.map((r) => ({name: r.locationName, createdAt: r.createdAt.getTime()}));
}

