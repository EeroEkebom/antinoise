import { describe, expect, test } from 'vitest';
import { CONFIG } from '../../src/core/rng.js';
import { createFxLms } from '../../src/core/fxlms.js';

const sr = CONFIG.SIM_SAMPLE_RATE;

function rms(x: number[]): number {
  return Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
}

describe('createFxLms', () => {
  test('convergence — 100 Hz sine, secondary path ≡ estimate → ≥12 dB residual reduction', () => {
    // True plant: anti-noise reaches zone with gain 0.9 and 20-sample delay. Estimate the same.
    const trueDelay = 20;
    const trueGain = 0.9;
    const ctl = createFxLms({ taps: 64, mu: 0.05, secondaryPath: delayLine(20, 0.9) });
    const refBuf: number[] = [];
    const recent: number[] = [];
    const early: number[] = [];
    for (let n = 0; n < 16000; n++) {
      const ref = Math.sin((2 * Math.PI * 100 * n) / sr);
      refBuf[n] = ref;
      const out = ctl.process(ref);
      // zone: ambient noise and anti-noise both traverse the same 20-sample path — cancellation is causal here
      const ambient = n >= trueDelay ? 0.5 * refBuf[n - trueDelay] : 0;
      const residual = ambient - plant(out, n, trueDelay, trueGain);
      if (n < 1000) early.push(residual);
      if (n >= 8000) recent.push(residual);
      ctl.adapt(residual, out);
    }
    const reductionDb = 20 * Math.log10(rms(early) / rms(recent));
    expect(reductionDb).toBeGreaterThanOrEqual(12);
  });

  test('divergence guard — mu 100× safe value stays finite and bounded', () => {
    const ctl = createFxLms({ taps: 64, mu: 5, secondaryPath: delayLine(20, 0.9) });
    let energy = 0;
    let openEnergy = 0;
    for (let n = 0; n < 16000; n++) {
      const ref = Math.sin((2 * Math.PI * 100 * n) / sr);
      const out = ctl.process(ref);
      expect(Number.isFinite(out)).toBe(true);
      const residual = ref * 0.5 - plant(out, n, 20, 0.9);
      energy += residual * residual;
      openEnergy += Math.pow(ref * 0.5, 2);
      ctl.adapt(residual, out);
    }
    expect(energy).toBeLessThan(openEnergy * 4);
  });

  test('silence — zero reference and residual for 1000 steps yields no NaN', () => {
    const ctl = createFxLms({ taps: 32, mu: 0.1, secondaryPath: delayLine(10, 1) });
    for (let n = 0; n < 1000; n++) {
      const out = ctl.process(0);
      ctl.adapt(0, out);
      expect(Number.isFinite(out)).toBe(true);
    }
  });

  test('non-finite reference sample cannot poison the weights', () => {
    const ctl = createFxLms({ taps: 64, mu: 0.05, secondaryPath: delayLine(20, 0.9) });
    const refBuf: number[] = [];
    const plantBuf: number[] = [];
    const early: number[] = [];
    const late: number[] = [];
    for (let n = 0; n < 16000; n++) {
      const ref = n === 5 ? NaN : Math.sin((2 * Math.PI * 100 * n) / sr);
      refBuf[n] = ref;
      const out = ctl.process(ref);
      expect(Number.isFinite(out)).toBe(true);
      plantBuf[n] = out;
      const ambient = n >= 20 ? 0.5 * refBuf[n - 20] : 0; // NaN passes through ref history like the plant would
      const residual = ambient - (n - 20 >= 0 ? plantBuf[n - 20] * 0.9 : 0);
      if (n > 100 && n < 1200) early.push(Number.isFinite(residual) ? residual : 0);
      if (n >= 14000) late.push(residual);
      ctl.adapt(Number.isFinite(residual) ? residual : 0, out);
    }
    // the controller recovers: late residual well below the early transient
    expect(rms(late)).toBeLessThanOrEqual(0.5 * rms(early));
  });

  test('wrong secondary-path estimate (5× low) does not amplify the zone', () => {
    const ctl = createFxLms({ taps: 64, mu: 0.05, secondaryPath: delayLine(20, 0.18) }); // ŝ = 0.18 vs plant 0.9
    const refBuf: number[] = [];
    const plantBuf: number[] = [];
    const recent: number[] = [];
    let openSq = 0;
    let openN = 0;
    for (let n = 0; n < 16000; n++) {
      const ref = Math.sin((2 * Math.PI * 100 * n) / sr);
      refBuf[n] = ref;
      const out = ctl.process(ref);
      expect(Number.isFinite(out)).toBe(true);
      plantBuf[n] = out;
      const ambient = n >= 20 ? 0.5 * refBuf[n - 20] : 0;
      const residual = ambient - (n - 20 >= 0 ? plantBuf[n - 20] * 0.9 : 0);
      if (n >= 8000) {
        recent.push(residual);
        openSq += ambient * ambient;
        openN++;
      }
      ctl.adapt(residual, out);
    }
    const openRms = Math.sqrt(openSq / openN);
    expect(rms(recent)).toBeLessThanOrEqual(1.5 * openRms); // never meaningfully louder than open loop
  });
});

function delayLine(taps: number, gain: number): number[] {
  const p = new Array(taps).fill(0);
  p[taps - 1] = gain;
  return p;
}

/** Plant model: the cancelled signal arrives at the zone delayed + attenuated (secondary path). */
let plantBuf: number[] = [];
function plant(out: number, n: number, delay: number, gain: number): number {
  plantBuf[n] = out;
  return n - delay >= 0 ? plantBuf[n - delay] * gain : 0;
}