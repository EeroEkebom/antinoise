import { describe, expect, test } from 'vitest';
import { prepareAudioBuffers } from '../../src/audio/bridge.js';

/** N periods of a sine at `freq` Hz over `sr`, peak 0.5. */
function sine(freq: number, sr: number, periods: number): Float32Array {
  const n = Math.round((sr / freq) * periods);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * Math.sin((2 * Math.PI * freq * i) / sr);
  return out;
}

function firstZeroCrossing(a: Float32Array): number {
  for (let i = 1; i < a.length; i++) if (a[i - 1] >= 0 && a[i] < 0) return i;
  return -1;
}

describe('prepareAudioBuffers', () => {
  test('100 Hz sine 16000→48000: period preserved to ±1 output sample, RMS within 5%', () => {
    const sr = 48000;
    const src = sine(100, 16000, 5); // 5 periods
    const r = prepareAudioBuffers({ open: src, closed: new Float32Array(0) }, sr);
    // 100 Hz at 48 kHz → period 480 samples. firstZeroCrossing on the subarray returns a relative index.
    const p = firstZeroCrossing(r.open);
    const p2 = firstZeroCrossing(r.open.subarray(p + 1));
    const period = p2 + 1;
    expect(period).toBeGreaterThanOrEqual(479);
    expect(period).toBeLessThanOrEqual(481);
    const rms = (a: Float32Array) =>
      Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(Math.abs(rms(r.open) / rms(src) - 1)).toBeLessThan(0.05);
  });

  test('identity resample (16000→16000) returns the limiter-mapped input, no resampling artifacts', () => {
    const src = sine(100, 16000, 2);
    const r = prepareAudioBuffers({ open: src, closed: new Float32Array(4) }, 16000);
    expect(r.open.length).toBe(src.length);
    for (let i = 0; i < src.length; i++) expect(r.open[i]).toBeCloseTo(src[i], 9); // transparent below the knee
  });

  test('worst-case render stays within [-1, 1] after the master limiter', () => {
    const loud = sine(100, 16000, 2).map((v) => v * 4); // peak 2.0
    const r = prepareAudioBuffers({ open: loud, closed: loud }, 48000);
    for (const v of r.open) expect(Math.abs(v)).toBeLessThanOrEqual(1.0);
    for (const v of r.closed) expect(Math.abs(v)).toBeLessThanOrEqual(1.0);
  });
});