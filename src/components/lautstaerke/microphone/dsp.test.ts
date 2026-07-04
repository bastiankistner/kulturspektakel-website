import {describe, expect, it} from 'vitest';
import {BAND_FREQUENCIES} from '../bluetooth';
import {
  A_WEIGHTING,
  C_WEIGHTING,
  DB_MIN,
  DB_MAX,
  buildMicFrame,
  encodeDb,
  spectrumToBands,
  weightedLeq,
} from './dsp';

// Build an FFT magnitude array where a single bin (nearest to `freq`) carries
// all the energy, everything else silent.
function tone(freq: number, binHz: number, bins: number, mag: number) {
  const arr = new Float32Array(bins);
  const idx = Math.round(freq / binHz);
  if (idx > 0 && idx < bins) arr[idx] = mag;
  return arr;
}

describe('encodeDb', () => {
  it('maps the device scale: 20 dB → 0, and is monotonic + clamped 0–255', () => {
    expect(encodeDb(DB_MIN)).toBe(0);
    expect(encodeDb(DB_MIN - 50)).toBe(0); // clamps low
    expect(encodeDb(DB_MAX + 50)).toBe(255); // clamps high
    expect(encodeDb(70)).toBe(Math.round((70 - 20) * 2)); // 100
    expect(encodeDb(40)).toBeLessThan(encodeDb(60));
  });
});

describe('spectrumToBands', () => {
  const binHz = 48000 / 4096;
  const bins = 2048;

  it('returns one level per IEC band', () => {
    const bands = spectrumToBands(new Float32Array(bins), binHz, 130);
    expect(bands).toHaveLength(BAND_FREQUENCIES.length);
  });

  it('silent spectrum reads the floor everywhere', () => {
    const bands = spectrumToBands(new Float32Array(bins), binHz, 130);
    expect(bands.every((d) => d === DB_MIN)).toBe(true);
  });

  it('a 1 kHz tone lights the 1 kHz band and leaves distant bands at the floor', () => {
    const oneK = BAND_FREQUENCIES.indexOf(1000);
    const bands = spectrumToBands(tone(1000, binHz, bins, 1), binHz, 130);
    expect(bands[oneK]).toBeGreaterThan(DB_MIN);
    // A band two octaves away should be untouched.
    const farBand = BAND_FREQUENCIES.indexOf(250);
    expect(bands[farBand]).toBe(DB_MIN);
  });

  it('louder tone → higher band dB (monotonic in magnitude)', () => {
    const oneK = BAND_FREQUENCIES.indexOf(1000);
    const quiet = spectrumToBands(tone(1000, binHz, bins, 0.01), binHz, 130)[oneK];
    const loud = spectrumToBands(tone(1000, binHz, bins, 1), binHz, 130)[oneK];
    expect(loud).toBeGreaterThan(quiet);
  });

  it('never exceeds the encodable range', () => {
    const bands = spectrumToBands(tone(1000, binHz, bins, 1e6), binHz, 200);
    expect(Math.max(...bands)).toBeLessThanOrEqual(DB_MAX);
    expect(Math.min(...bands)).toBeGreaterThanOrEqual(DB_MIN);
  });
});

describe('weighting curves', () => {
  it('A-weighting attenuates lows and highs, ~0 near 1 kHz', () => {
    const oneK = BAND_FREQUENCIES.indexOf(1000);
    const low = BAND_FREQUENCIES.indexOf(63);
    expect(Math.abs(A_WEIGHTING[oneK])).toBeLessThan(1); // ~0 dB at 1 kHz
    expect(A_WEIGHTING[low]).toBeLessThan(-20); // strong low-freq roll-off
  });

  it('C-weighting is flatter through the mids than A', () => {
    const low = BAND_FREQUENCIES.indexOf(63);
    expect(C_WEIGHTING[low]).toBeGreaterThan(A_WEIGHTING[low]);
  });

  it('weightedLeq of a silent spectrum stays at the floor-ish, finite', () => {
    const bands = new Array(BAND_FREQUENCIES.length).fill(DB_MIN);
    const leq = weightedLeq(bands, A_WEIGHTING);
    expect(Number.isFinite(leq)).toBe(true);
    expect(leq).toBeGreaterThanOrEqual(DB_MIN);
    expect(leq).toBeLessThanOrEqual(DB_MAX);
  });
});

describe('buildMicFrame', () => {
  const binHz = 48000 / 4096;
  const bins = 2048;

  it('produces 31 band bytes + encoded levels in range', () => {
    const f = buildMicFrame(tone(1000, binHz, bins, 0.5), binHz, 130, 0.3);
    expect(f.bands).toHaveLength(31);
    for (const b of f.bands) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(255);
    }
    for (const v of [f.laeq1s, f.lceq1s, f.lafmax1s, f.lcfmax1s, f.lcpeak1s]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(255);
    }
  });

  it('a silent frame with no peak encodes to the floor', () => {
    const f = buildMicFrame(new Float32Array(bins), binHz, 130, 0);
    expect(f.lcpeak1s).toBe(0);
    expect(f.bands.every((b) => b === 0)).toBe(true);
  });
});
