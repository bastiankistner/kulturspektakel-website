import {createFileRoute, notFound} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {crewAuth} from '../server/crewAuth';
import {useEffect, useMemo, useState} from 'react';
import {Box} from '@chakra-ui/react';
import type uPlot from 'uplot';
import {
  HISTORY_SERIES,
  useLautstaerkeCtx,
} from '../components/lautstaerke/context';
import {
  BigNumberRow,
  useSeriesToggle,
} from '../components/lautstaerke/BigNumber';
import {NoiseTimeChart} from '../components/lautstaerke/NoiseTimeChart';
import {deviceTitle, useDeviceView} from '../components/lautstaerke/deviceView';
import {fmtHourMinute} from '../components/lautstaerke/chartUtils';
import {noiseHistory} from '../server/noiseHistory.server';
import {
  localDayRange,
  rowsToAligned,
} from '../components/lautstaerke/noiseHistory.shared';
import {history as surrealHistory} from '../components/lautstaerke/surreal/store';
import {readPersistedSource} from '../components/lautstaerke/surreal/readSource';
import type {Surreal} from '@frachter-app/surrealdb';
import {seo} from '../utils/seo';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const loadHistory = createServerFn()
  .middleware([crewAuth])
  .inputValidator((d: {device: string; date: string}) => d)
  .handler(async ({data}) => {
    if (!DATE_RE.test(data.date)) throw notFound();
    const rows = await noiseHistory(data.device, data.date);
    const {start, end} = localDayRange(data.date);
    return {
      aligned: rowsToAligned(rows),
      start: start.getTime(),
      end: end.getTime(),
    };
  });

export const Route = createFileRoute('/crew/lautstaerke/$device/$date')({
  component: DeviceHistory,
  loader: async ({params}) => {
    // Skip the (expensive) Neon aggregation when the crew member is reading from
    // the local SurrealDB volume — the component fetches from Surreal client-side
    // and never uses this result. Persisted read-source is client-only, so on the
    // server (first load) this is always 'neon' and the query runs as before; on
    // client navigations it honors the choice. Empty aligned data is a valid
    // placeholder until the local query resolves.
    if (readPersistedSource() === 'surreal') {
      const {start, end} = localDayRange(params.date);
      return {
        aligned: rowsToAligned([]),
        start: start.getTime(),
        end: end.getTime(),
      };
    }
    return loadHistory({data: {device: params.device, date: params.date}});
  },
  head: ({matches, params}) =>
    seo({
      title: `Lautstärke – ${deviceTitle(matches, params.device, params.date)} – ${params.date}`,
    }),
});

function DeviceHistory() {
  const {device, date} = Route.useParams();
  const neon = Route.useLoaderData();
  const {weighting} = useDeviceView();
  const {storage} = useLautstaerkeCtx();
  const [cursorIdx, setCursorIdx] = useState<number | 'gap' | null>(null);
  const {shown, toggle} = useSeriesToggle(HISTORY_SERIES);

  // When reading from the local SurrealDB volume, replace the Neon-loaded data
  // with a client-side range-scan of the opfs:// volume (SurrealDB is
  // browser-only, so it can't run in the server-fn loader). Falls back to the
  // Neon data until the local query resolves.
  const useSurreal = storage.readSource === 'surreal';
  const [surreal, setSurreal] = useState<{
    aligned: number[][];
    start: number;
    end: number;
  } | null>(null);

  useEffect(() => {
    if (!useSurreal || storage.status !== 'ready' || !storage.db) {
      setSurreal(null);
      return;
    }
    let cancelled = false;
    const {start, end} = localDayRange(date);
    void surrealHistory(
      storage.db as Surreal,
      device,
      start.getTime(),
      end.getTime(),
    )
      .then((rows) => {
        if (cancelled) return;
        setSurreal({
          aligned: rowsToAligned(rows),
          start: start.getTime(),
          end: end.getTime(),
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error('[lautstärke] surreal history failed', e);
        setSurreal(null);
      });
    return () => {
      cancelled = true;
    };
  }, [useSurreal, storage.status, storage.db, device, date]);

  const {aligned, start, end} = useSurreal && surreal ? surreal : neon;

  // Stable per loaded day + source, so NoiseTimeChart re-pushes only when the
  // underlying data changes.
  const data = useMemo(
    () => aligned as unknown as uPlot.AlignedData,
    [aligned],
  );

  return (
    <>
      {/* No liveValue: the numbers stay blank until the cursor hovers a sample. */}
      <BigNumberRow
        series={HISTORY_SERIES}
        weighting={weighting}
        shown={shown}
        toggle={toggle}
        cursorIdx={cursorIdx}
        data={data}
      />
      <Box flex="1" minH="0" display="flex">
        <NoiseTimeChart
          data={data}
          series={HISTORY_SERIES}
          weighting={weighting}
          shown={shown}
          xRange={() => [start / 1000, end / 1000]}
          xAxisFormat={fmtHourMinute}
          gapThresholdX={120}
          onCursorIdx={setCursorIdx}
        />
      </Box>
    </>
  );
}
