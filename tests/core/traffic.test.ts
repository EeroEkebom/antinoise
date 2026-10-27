import { describe, expect, test } from 'vitest';
import { createRng } from '../../src/core/rng.js';
import { createTrafficSource } from '../../src/core/traffic.js';
import { CONFIG } from '../../src/core/rng.js';

const sr = CONFIG.SIM_SAMPLE_RATE;

describe('createTrafficSource', () => {
  test('determinism — equal-seeded rngs emit identical 1 s sequences', () => {
    const a = createTrafficSource(createRng(7), sr);
    const b = createTrafficSource(createRng(7), sr);
    const seqA = Array.from({ length: 16000 }, () => a.nextSample());
    const seqB = Array.from({ length: 16000 }, () => b.nextSample());
    expect(seqA).toEqual(seqB);
  });

  test('content is low-frequency — zero crossings imply dominant pitch below ~2.7 kHz', () => {
    const src = createTrafficSource(createRng(11), sr);
    let crossings = 0;
    let prev = 0;
    for (let i = 0; i < 16000; i++) {
      const s = src.nextSample();
      if (prev < 0 && s >= 0) crossings++;
      prev = s;
    }
    // 2.7 kHz upper bound ≈ one crossing per ~3 samples averaged
    const crossingsPerSample = crossings / 16000;
    expect(crossingsPerSample).toBeLessThan(1 / 3);
  });

  test('non-silence — RMS in [0.05, 1.0] over 1 s', () => {
    const src = createTrafficSource(createRng(13), sr);
    let sumSq = 0;
    const n = 16000;
    for (let i = 0; i < n; i++) sumSq += src.nextSample() ** 2;
    const rms = Math.sqrt(sumSq / n);
    expect(rms).toBeGreaterThanOrEqual(0.05);
    expect(rms).toBeLessThanOrEqual(1.0);
  });
});