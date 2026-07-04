// Web Audio capture for the local-microphone noise source. Opens the mic via
// getUserMedia, runs an AnalyserNode, accumulates FFT + peak statistics over each
// 1-second window, and emits one NoiseRecording-shaped frame per second through
// the supplied callback — the same shape the MQTT/BLE device path produces, so it
// flows through the existing ingest pipeline (charts + SurrealDB) unchanged.
import type {NoiseRecording} from '../../../proto/noise';
import {buildMicFrame} from './dsp';

export const MIC_DEVICE_NAME = 'mikrofon-lokal';

// Default display offset that lifts uncalibrated dBFS onto the 20–110 device
// scale so a normal room lands mid-chart. Relative, not SPL — see dsp.ts.
const DEFAULT_OFFSET_DB = 130;
const FFT_SIZE = 4096; // ~11.7 Hz bins at 48 kHz — enough for the low bands.

export interface MicHandle {
  stop(): Promise<void>;
}

export function isMicrophoneSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    (typeof AudioContext !== 'undefined' ||
      typeof (globalThis as {webkitAudioContext?: unknown})
        .webkitAudioContext !== 'undefined')
  );
}

/**
 * Start capturing from the default microphone. Calls `onFrame` once per second
 * with a synthetic single-record NoiseRecording (relative levels). Rejects if
 * permission is denied or Web Audio is unavailable. Resolve value's `stop()`
 * tears everything down (tracks, context, timer).
 */
export async function startMicrophone(
  onFrame: (frame: NoiseRecording, receiveTime: number) => void,
  offsetDb = DEFAULT_OFFSET_DB,
): Promise<MicHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const Ctx =
    typeof AudioContext !== 'undefined'
      ? AudioContext
      : (globalThis as unknown as {webkitAudioContext: typeof AudioContext})
          .webkitAudioContext;
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = FFT_SIZE;
  analyser.smoothingTimeConstant = 0; // we do our own per-second averaging
  source.connect(analyser);

  const binCount = analyser.frequencyBinCount; // FFT_SIZE / 2
  const binHz = ctx.sampleRate / FFT_SIZE;
  const freqScratch = new Float32Array(binCount);
  const timeScratch = new Float32Array(analyser.fftSize);

  // Per-second accumulators.
  let sumMag = new Float64Array(binCount);
  let frames = 0;
  let peakSample = 0;

  // Sample the analyser fast (~50 Hz) and average into the second window.
  const sampleMs = 20;
  const sampleTimer = setInterval(() => {
    // getFloatFrequencyData gives dB (dBFS) per bin; convert to linear magnitude
    // for power averaging (10^(dBFS/20)).
    analyser.getFloatFrequencyData(freqScratch);
    for (let i = 0; i < binCount; i++) {
      const mag = Math.pow(10, freqScratch[i] / 20);
      sumMag[i] += mag;
    }
    analyser.getFloatTimeDomainData(timeScratch);
    for (let i = 0; i < timeScratch.length; i++) {
      const a = Math.abs(timeScratch[i]);
      if (a > peakSample) peakSample = a;
    }
    frames++;
  }, sampleMs);

  // Emit one frame per second from the accumulated stats, then reset.
  const emitTimer = setInterval(() => {
    if (frames === 0) return;
    const avg = new Float32Array(binCount);
    for (let i = 0; i < binCount; i++) avg[i] = sumMag[i] / frames;

    const f = buildMicFrame(avg, binHz, offsetDb, peakSample);
    const record: NoiseRecording = {
      records: [
        {
          seqNo: Math.floor(Date.now() / 1000),
          bands: Uint8Array.from(f.bands),
          laeq1s: f.laeq1s,
          lceq1s: f.lceq1s,
          lafmax1s: f.lafmax1s,
          lcfmax1s: f.lcfmax1s,
          lcpeak1s: f.lcpeak1s,
        },
      ],
      // Windowed aggregates aren't computed for the mic; leave undefined so the
      // 5m/30m series simply show no line (same as an unwarmed device buffer).
      batteryMv: undefined,
      laeq5m: undefined,
      lceq5m: undefined,
      laeq30m: undefined,
      lceq30m: undefined,
    };
    onFrame(record, Date.now());

    sumMag = new Float64Array(binCount);
    frames = 0;
    peakSample = 0;
  }, 1000);

  return {
    async stop() {
      clearInterval(sampleTimer);
      clearInterval(emitTimer);
      for (const t of stream.getTracks()) t.stop();
      try {
        await ctx.close();
      } catch {
        /* ignore */
      }
    },
  };
}
