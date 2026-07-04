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
  const {days, locations} = Route.useLoaderData();
  const [weighting, setWeighting] = useState<Weighting>('A');
  const toggleWeighting = () => setWeighting((w) => (w === 'A' ? 'C' : 'A'));

  // The microphone is a VIRTUAL device (MIC_DEVICE_NAME): its data only exists
  // while capture is running. Landing on this device via a direct URL / reload
  // would otherwise show an empty view (nothing has started capture). So
  // auto-start capture when this is the mic device on the live view and it isn't
  // already running. Runs once per mount attempt (permissionTriedRef) so a
  // denied getUserMedia doesn't re-prompt in a loop.
  const {microphone} = useLautstaerkeCtx();
  const permissionTriedRef = useRef(false);
  const isMicDevice = device === MIC_DEVICE_NAME;
  const onLiveView = date == null;
  // Read the live mic slice off a ref so the effect can depend ONLY on the
  // stable route conditions. `microphone.start`'s identity churns whenever the
  // Surreal write-sink / read-source changes (it closes over the ingest chain);
  // listing it in the deps would re-run this effect on unrelated toggles. The
  // fire-once permissionTriedRef guard means the stale closure is fine — and
  // startMic itself no-ops if capture is already running.
  const micRef = useRef(microphone);
  micRef.current = microphone;
  useEffect(() => {
    if (!isMicDevice || !onLiveView) return;
    if (permissionTriedRef.current) return;
    const mic = micRef.current;
    if (!mic.supported || mic.active || mic.starting) return;
    permissionTriedRef.current = true;
    void mic.start().catch(() => {
      // start() already toasts on real failures; swallow user-cancel/denial so
      // we don't rethrow into the effect.
    });
  }, [isMicDevice, onLiveView]);

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
