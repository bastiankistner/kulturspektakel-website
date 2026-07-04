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

// Build a per-bin POWER array where a single bin (nearest to `freq`) carries all
// the energy, everything else silent. spectrumToBands/buildMicFrame take power.
function tone(freq: number, binHz: number, bins: number, power: number) {
  const arr = new Float32Array(bins);
  const idx = Math.round(freq / binHz);
  if (idx > 0 && idx < bins) arr[idx] = power;
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

// Regression tests for the three DSP accuracy fixes.
describe('band tiling + resolution (regression)', () => {
  // The production FFT resolution: 16384-point FFT at 48 kHz.
  const binHz = 48000 / 16384; // ≈ 2.93 Hz
  const bins = 16384 / 2;

  it('every in-range FFT bin lands in exactly one band (no gaps, no double-count)', () => {
    // Give every bin unit power; count how many bands each bin could match by
    // re-deriving the exact edges the same way dsp.ts does.
    const edges = BAND_FREQUENCIES.map((_, b) => {
      const fm = 1000 * Math.pow(10, (b - 18) / 10);
      return {lo: fm * Math.pow(10, -1 / 20), hi: fm * Math.pow(10, 1 / 20)};
    });
    const lowEdge = edges[0].lo;
    const highEdge = edges[edges.length - 1].hi;
    let dropped = 0;
    let doubled = 0;
    for (let i = 1; i < bins; i++) {
      const f = i * binHz;
      if (f < lowEdge || f >= highEdge) continue; // out of the 31-band span
      const matches = edges.filter((e) => f >= e.lo && f < e.hi).length;
      if (matches === 0) dropped++;
      if (matches > 1) doubled++;
    }
    // Exact base-10 edges tile perfectly: no interior bin is dropped or doubled.
    expect(dropped).toBe(0);
    expect(doubled).toBe(0);
  });

  it('the low bands (16, 20, 40 Hz) receive energy at the production resolution', () => {
    // With FFT_SIZE 4096 these bands were empty (bins too coarse) and always read
    // the floor. At 16384 they must respond to a tone in-band.
    for (const hz of [16, 20, 40] as const) {
      const bandIdx = BAND_FREQUENCIES.indexOf(hz);
      const bands = spectrumToBands(tone(hz, binHz, bins, 1), binHz, 130);
      expect(bands[bandIdx]).toBeGreaterThan(DB_MIN);
    }
  });
});

describe('power averaging (regression)', () => {
  const binHz = 48000 / 16384;
  const bins = 16384 / 2;
  const oneK = BAND_FREQUENCIES.indexOf(1000);

  it('band dB of a fluctuating signal equals the mean POWER, not the mean magnitude', () => {
    // A 1 kHz tone alternating between power 0.01 and 1.0 across two "frames".
    // Correct (power) average = (0.01 + 1)/2 = 0.505.
    // Old magnitude path: mean magnitude ((0.1+1)/2)=0.55, squared = 0.3025 —
    // ~2.2 dB lower. Use a large offset so both stay above the DB_MIN floor and
    // the DIFFERENCE is what's measured.
    const off = 100;
    const a = tone(1000, binHz, bins, 0.01);
    const b = tone(1000, binHz, bins, 1.0);
    const avgPower = new Float32Array(bins);
    for (let i = 0; i < bins; i++) avgPower[i] = (a[i] + b[i]) / 2;
    const bandPowerAvg = spectrumToBands(avgPower, binHz, off)[oneK];

    // What the OLD magnitude-averaging path would have produced:
    const magSquared = new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      const meanMag = (Math.sqrt(a[i]) + Math.sqrt(b[i])) / 2;
      magSquared[i] = meanMag * meanMag;
    }
    const bandMagAvg = spectrumToBands(magSquared, binHz, off)[oneK];

    // Both above the floor, and power-averaging reads ~2 dB HIGHER (correct).
    expect(bandPowerAvg).toBeGreaterThan(DB_MIN);
    expect(bandMagAvg).toBeGreaterThan(DB_MIN);
    expect(bandPowerAvg).toBeGreaterThan(bandMagAvg + 1.5);
  });
});

describe('buildMicFrame', () => {
  const binHz = 48000 / 16384;
  const bins = 16384 / 2;

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
