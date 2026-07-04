// Pure DSP for the local-microphone noise source. Kept free of Web Audio / DOM
// so it can be unit-tested headlessly: given an FFT magnitude spectrum it
// produces the same `NoiseRecording_Record` shape the hardware device emits.
//
// IMPORTANT — this is RELATIVE loudness, not calibrated SPL. A browser mic gives
// an uncalibrated signal (dBFS), so we map it onto the device's 20–110 dB
// display scale with a fixed offset. Treat the numbers as "how loud, relative"
// — never as lab-accurate decibels. The UI labels the source accordingly.
import {BAND_FREQUENCIES} from '../bluetooth';

// The device encodes every level as one uint8: byte = (dB - 20) * 2, so the
// representable range is 20 dB (byte 0) … 147.5 dB (byte 255). We clamp to that.
export const DB_MIN = 20;
export const DB_MAX = 147.5;

/** Encode a dB value to the device's one-byte scale ((dB-20)*2, clamped 0–255). */
export function encodeDb(db: number): number {
  const clamped = Math.max(DB_MIN, Math.min(DB_MAX, db));
  return Math.round((clamped - DB_MIN) * 2);
}

// Exact IEC base-10 1/3-octave EDGE frequencies. The `BAND_FREQUENCIES` labels
// are rounded (16, 20, 25, 31.5, 63, 125, 160, 630, …) and are NOT geometrically
// spaced, so edges derived from them (f·2^±1/6) don't tile — leaving gaps (real
// in-range energy discarded) and overlaps. Instead derive edges from the exact
// preferred midband frequencies fm = 1000·10^((b−18)/10) (index 18 = 1 kHz in
// BAND_FREQUENCIES) with 1/3-octave edges fm·10^±(1/20); then hi[b] === lo[b+1]
// exactly, so every bin lands in exactly one band and none is dropped.
const BAND_EDGES = BAND_FREQUENCIES.map((_, b) => {
  const fm = 1000 * Math.pow(10, (b - 18) / 10);
  return {lo: fm * Math.pow(10, -1 / 20), hi: fm * Math.pow(10, 1 / 20)};
});

/**
 * Map a per-bin POWER spectrum (linear power, bin i covers [i·binHz]) onto the 31
 * IEC 1/3-octave bands in {@link BAND_FREQUENCIES}, returning each band's level
 * in dB (relative, offset-applied). Bins are summed into the band whose exact
 * 1/3-octave edges contain the bin centre (see {@link BAND_EDGES}); empty bands
 * read DB_MIN.
 *
 * The input is mean POWER per bin (magnitude²), not magnitude, so that averaging
 * over time upstream is energy-correct (Leq must average power, not amplitude).
 *
 * `offsetDb` shifts dBFS-ish values onto the display scale (default tuned so a
 * normal room lands mid-scale). `refDb` is the 0-dBFS reference used for the
 * 10·log10 conversion.
 */
export function spectrumToBands(
  binPower: Float32Array | number[],
  binHz: number,
  offsetDb: number,
  refDb = 0,
): number[] {
  const n = binPower.length;
  const power = new Array(BAND_FREQUENCIES.length).fill(0);
  const count = new Array(BAND_FREQUENCIES.length).fill(0);

  for (let i = 1; i < n; i++) {
    const freq = i * binHz;
    // Bands tile exactly, so a bin falls in at most one; find it and stop.
    for (let b = 0; b < BAND_EDGES.length; b++) {
      if (freq >= BAND_EDGES[b].lo && freq < BAND_EDGES[b].hi) {
        power[b] += binPower[i];
        count[b]++;
        break;
      }
    }
  }

  return power.map((p, b) => {
    if (count[b] === 0) return DB_MIN;
    // Mean power in the band → dB, plus the display offset and reference.
    const db = 10 * Math.log10(p / count[b]) + offsetDb + refDb;
    return Math.max(DB_MIN, Math.min(DB_MAX, db));
  });
}

/**
 * Broadband equivalent level (energy sum across all bands) in dB. A/C weighting
 * is applied per band via {@link A_WEIGHTING}/{@link C_WEIGHTING} before summing.
 */
export function weightedLeq(
  bandDb: number[],
  weighting: readonly number[],
): number {
  let energy = 0;
  for (let b = 0; b < bandDb.length; b++) {
    const w = weighting[b] ?? 0;
    energy += Math.pow(10, (bandDb[b] + w) / 10);
  }
  const db = 10 * Math.log10(energy);
  return Math.max(DB_MIN, Math.min(DB_MAX, db));
}

// A- and C-weighting curves at the 31 band centres (dB), from the IEC 61672
// analytic weighting formulas evaluated at BAND_FREQUENCIES. Precomputed so the
// per-second path does no pow() for weights.
export const A_WEIGHTING: readonly number[] = BAND_FREQUENCIES.map((f) =>
  aWeightDb(f),
);
export const C_WEIGHTING: readonly number[] = BAND_FREQUENCIES.map((f) =>
  cWeightDb(f),
);

function aWeightDb(f: number): number {
  const f2 = f * f;
  const ra =
    (12194 ** 2 * f2 ** 2) /
    ((f2 + 20.6 ** 2) *
      Math.sqrt((f2 + 107.7 ** 2) * (f2 + 737.9 ** 2)) *
      (f2 + 12194 ** 2));
  return 20 * Math.log10(ra) + 2.0;
}

function cWeightDb(f: number): number {
  const f2 = f * f;
  const rc = (12194 ** 2 * f2) / ((f2 + 20.6 ** 2) * (f2 + 12194 ** 2));
  return 20 * Math.log10(rc) + 0.06;
}

/** The shape the mic emits each second — a superset of NoiseRecording_Record. */
export interface MicFrame {
  bands: number[]; // 31 encoded bytes
  laeq1s: number;
  lceq1s: number;
  lafmax1s: number;
  lcfmax1s: number;
  lcpeak1s: number;
}

/**
 * Build one per-second record from the accumulated FFT statistics of that
 * second: `avgBinPower` (mean linear POWER per bin, magnitude² averaged over the
 * window — averaging power, not amplitude, is what makes the Leq energy-correct)
 * and `peakSample` (max abs time-domain sample, 0–1). Everything is returned in
 * the device's byte encoding.
 */
export function buildMicFrame(
  avgBinPower: Float32Array | number[],
  binHz: number,
  offsetDb: number,
  peakSample: number,
): MicFrame {
  const bandDb = spectrumToBands(avgBinPower, binHz, offsetDb);
  const laeq = weightedLeq(bandDb, A_WEIGHTING);
  const lceq = weightedLeq(bandDb, C_WEIGHTING);
  // Fast max ≈ the equivalent here (single-second window); peak from the raw
  // sample amplitude mapped through the same offset.
  const peakDb =
    peakSample > 0
      ? Math.max(DB_MIN, Math.min(DB_MAX, 20 * Math.log10(peakSample) + offsetDb + 94))
      : DB_MIN;
  return {
    bands: bandDb.map(encodeDb),
    laeq1s: encodeDb(laeq),
    lceq1s: encodeDb(lceq),
    lafmax1s: encodeDb(laeq),
    lcfmax1s: encodeDb(lceq),
    lcpeak1s: encodeDb(peakDb),
  };
}
