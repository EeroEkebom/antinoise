import { describe, expect, test } from 'vitest';
import { CONFIG } from '../../src/core/rng.js';
import { propagate } from '../../src/core/propagate.js';

const sr = CONFIG.SIM_SAMPLE_RATE;
const TEN_SECONDS = 160000;

function impulse(len: number, at: number): Float32Array {
  const s = new Float32Array(len);
  s[at] = 1;
  return s;
}

function peakIndex(s: Float32Array): number {
  let idx = 0;
  for (let i = 1; i < s.length; i++) if (Math.abs(s[i]) > Math.abs(s[i - 1])) idx = i;
  return idx;
}

describe('propagate', () => {
  test('exactly whole-sample distance shifts impulse by exactly N samples', () => {
    const samplesDelayed = 100; // target delay in samples
    const distanceMeters = (samplesDelayed / sr) * CONFIG.SPEED_OF_SOUND; // 100/16000 * 343 ≈ 2.14 m
    const { out, samplesDelayed: d, gain } = propagate(impulse(2000, 200), distanceMeters, sr);
    expect(d).toBe(samplesDelayed);
    expect(peakIndex(out)).toBeGreaterThan(298);
    // whole-sample case: single clean shifted impulse, scaled by the path gain
    expect(out[samplesDelayed + 200]).toBeCloseTo(gain, 5);
  });

  test('sub-sample distance splits impulse peak across two adjacent samples ±0.05', () => {
    const delaySamples = 100.5;
    const distanceMeters = (delaySamples / sr) * CONFIG.SPEED_OF_SOUND;
    const { out } = propagate(impulse(2000, 200), distanceMeters, sr);
    const a = out[200 + 100];
    const b = out[200 + 101];
    expect(a).toBeGreaterThan(0.35);
    expect(b).toBeGreaterThan(0.35);
    expect(Math.abs(a - b)).toBeLessThanOrEqual(0.05);
  });

  test('attenuation gain = 10/(10+d): 0 m → 1, 30 m → 0.25', () => {
    const silent0 = propagate(impulse(2000, 0), 0, sr);
    const silent30 = propagate(impulse(2000, 0), 30, sr);
    expect(silent0.gain).toBe(1);
    expect(silent30.gain).toBeCloseTo(0.25, 5);
  });

  test('gain uses configured speed of sound (temperature coupling is config-owned)', () => {
    // 331 m at 331 m/s = 1.000 s of delay at 16 kHz = sample 16000
    const { out } = propagate(impulse(20000, 0), 331, CONFIG.SIM_SAMPLE_RATE, 331);
    expect(peakIndex(out)).toBe(16000);
  });
});