export type Rng = { nextFloat(): number };

/** mulberry32 — small seeded PRNG, `[0,1)`. */
export function createRng(seed: number): Rng {
  let s = seed >>> 0;
  return {
    nextFloat(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Physics constants for the Antinoise simulation (values pinned by tests). */
export const CONFIG = {
  /** Speed of sound in air, m/s (default conditions). */
  SPEED_OF_SOUND: 343,
  /** Effective light speed in optical fiber, m/s (~2/3 c). Effectively instant vs sound. */
  FIBER_SPEED: 2.0e8,
  /** Internal simulation sample rate, Hz. Wave 2 resamples to the AudioContext rate. */
  SIM_SAMPLE_RATE: 16000,
} as const;