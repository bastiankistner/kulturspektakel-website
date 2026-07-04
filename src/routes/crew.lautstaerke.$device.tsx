import {createFileRoute, Outlet, useParams} from '@tanstack/react-router';
import {createServerFn} from '@tanstack/react-start';
import {crewAuth} from '../server/crewAuth';
import {useEffect, useRef, useState} from 'react';
import {Box} from '@chakra-ui/react';
import {
  useLautstaerkeCtx,
  type Weighting,
} from '../components/lautstaerke/context';
import {DeviceHeader} from '../components/lautstaerke/DeviceHeader';
import {
  DeviceViewContext,
  deviceTitle,
  resolveLocation,
} from '../components/lautstaerke/deviceView';
import {deviceLocations, noiseDays} from '../server/noiseHistory.server';
import {LAUTSTAERKE_DEMO} from '../components/lautstaerke/demoMode';
import {MIC_DEVICE_NAME} from '../components/lautstaerke/microphone/source';
import {days as surrealDaysQuery} from '../components/lautstaerke/surreal/store';
import type {Surreal} from '@frachter-app/surrealdb';
import {seo} from '../utils/seo';

const loadDevice = createServerFn()
  .middleware([crewAuth])
  .inputValidator((device: string) => device)
  .handler(async ({data: device}) => {
    const [days, locations] = await Promise.all([
      noiseDays(device),
      deviceLocations(device),
    ]);
    return {days, locations};
  });

export const Route = createFileRoute('/crew/lautstaerke/$device')({
  component: DeviceLayout,
  // Demo mode skips the crew-authed Neon lookups (day picker + location history);
  // the live view doesn't need them. Dead code in production (see demoMode.ts).
  loader: ({params}) =>
    LAUTSTAERKE_DEMO
      ? {days: [] as string[], locations: []}
      : loadDevice({data: params.device}),
  head: ({matches, params}) =>
    seo({title: `Lautstärke – ${deviceTitle(matches, params.device, null)}`}),
});

// Layout shared by the live and historical views: owns the weighting toggle and
// renders the common header, with the matched child view below via <Outlet />.
function DeviceLayout() {
  const {device} = Route.useParams();
  // The historical child adds a `date` param; its presence is how we tell the
  // two views apart (and what the day picker should show as selected).
  const {date} = useParams({strict: false});
  const {days: loaderDays, locations} = Route.useLoaderData();
  const [weighting, setWeighting] = useState<Weighting>('A');
  const toggleWeighting = () => setWeighting((w) => (w === 'A' ? 'C' : 'A'));

  // The microphone is a VIRTUAL device (MIC_DEVICE_NAME): its data only exists
  // while capture is running. Landing on this device via a direct URL / reload
  // would otherwise show an empty view (nothing has started capture). So
  // auto-start capture when this is the mic device on the live view and it isn't
  // already running. Runs once per mount attempt (permissionTriedRef) so a
  // denied getUserMedia doesn't re-prompt in a loop.
  const {microphone, storage} = useLautstaerkeCtx();
  const permissionTriedRef = useRef(false);
  const isMicDevice = device === MIC_DEVICE_NAME;
  const onLiveView = date == null;

  // Day picker source. The loader fills `days` from Neon (noiseDays), which is
  // empty when reading from the local SurrealDB volume (and in demo mode). So
  // when Surreal is the read source, query the distinct local days that have data
  // in the opfs volume for this device and use those instead — this is what makes
  // captured history reachable (e.g. from the local microphone) without Neon.
  const [surrealDays, setSurrealDays] = useState<string[] | null>(null);
  const useSurrealDays =
    storage.readSource === 'surreal' && storage.status === 'ready';
  useEffect(() => {
    if (!useSurrealDays || !storage.db) {
      setSurrealDays(null);
      return;
    }
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const db = storage.db as Surreal;
    const refresh = () => {
      void surrealDaysQuery(db, device, tz)
        .then((d) => {
          if (!cancelled) setSurrealDays(d);
        })
        .catch((e: unknown) => {
          if (!cancelled) {
            console.error('[lautstärke] surreal days failed', e);
          }
        });
    };
    refresh();
    // Re-query on a modest interval so a day that gains its first data mid-session
    // (e.g. the local mic recording right now, or midnight rolling over) appears
    // in the picker without a reload. The query is a light id-range scan.
    const id = setInterval(refresh, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Re-run the whole effect when the volume connects/changes or the device
    // changes; `date` is intentionally excluded so navigating live↔history
    // doesn't reset the interval.
  }, [useSurrealDays, storage.db, device]);

  // Surreal days take precedence when reading from Surreal; otherwise the
  // Neon-loaded list. If the currently-viewed `date` isn't in the list yet (e.g.
  // a direct URL to a day the query hasn't returned), include it so the picker
  // still shows the selected day.
  const days = useSurrealDays
    ? [...new Set([...(date ? [date] : []), ...(surrealDays ?? [])])].sort(
        (a, b) => b.localeCompare(a),
      )
    : loaderDays;
  // Read the volatile parts of the mic slice off a ref so the effect doesn't
  // depend on them. `microphone.start`'s identity churns whenever the Surreal
  // write-sink / read-source changes (it closes over the ingest chain), and
  // `active`/`starting` toggle during a start; listing any of them would re-run
  // this effect on unrelated changes. The fire-once permissionTriedRef guard
  // makes the stale closure safe, and startMic itself no-ops if already running.
  const micRef = useRef(microphone);
  micRef.current = microphone;
  // `supported` is the exception: it starts false and flips to true AFTER mount
  // (the layout probes isMicrophoneSupported() in its own effect). So it MUST be
  // a dependency — otherwise, on a direct load of the mic device, this effect
  // runs once while supported is still false, bails at the guard, and never
  // re-runs when support becomes known, so capture never auto-starts. It's
  // monotonic (false→true then stable), so it triggers exactly one extra run.
  const micSupported = microphone.supported;
  useEffect(() => {
    if (!isMicDevice || !onLiveView || !micSupported) return;
    if (permissionTriedRef.current) return;
    const mic = micRef.current;
    if (mic.active || mic.starting) return;
    permissionTriedRef.current = true;
    void mic.start().catch(() => {
      // start() already toasts on real failures; swallow user-cancel/denial so
      // we don't rethrow into the effect.
    });
  }, [isMicDevice, onLiveView, micSupported]);

  // Day-aware: the historical view shows where the device stood on that day.
  const location = resolveLocation(locations, date ?? null);

  return (
    <DeviceViewContext.Provider value={{weighting, toggleWeighting}}>
      <Box display="flex" flexDirection="column" flex="1" minH="0">
        <DeviceHeader
          device={device}
          location={location}
          days={days}
          dayValue={date ?? 'live'}
        />
        <Outlet />
      </Box>
    </DeviceViewContext.Provider>
  );
}
