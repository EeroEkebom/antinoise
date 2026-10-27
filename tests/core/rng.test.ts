import { describe, expect, test } from 'vitest';
import { createRng, CONFIG, type Rng } from '../../src/core/rng.js';

describe('createRng (mulberry32)', () => {
  test('same seed → identical 100-value sequence', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    const seqA = Array.from({ length: 100 }, () => a.nextFloat());
    const seqB = Array.from({ length: 100 }, () => b.nextFloat());
    expect(seqA).toEqual(seqB);
  });

  test('different seeds → different sequences', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 10 }, () => a.nextFloat());
    const seqB = Array.from({ length: 10 }, () => b.nextFloat());
    expect(seqA).not.toEqual(seqB);
  });

  test('values are within [0,1)', () => {
    const rng: Rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('CONFIG', () => {
  test('physics constants verbatim', () => {
    expect(CONFIG.SPEED_OF_SOUND).toBe(343);
    expect(CONFIG.FIBER_SPEED).toBe(2.0e8);
    expect(CONFIG.SIM_SAMPLE_RATE).toBe(16000);
  });
});