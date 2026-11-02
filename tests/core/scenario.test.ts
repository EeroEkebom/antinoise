import { describe, expect, test } from 'vitest';
import { createRng, CONFIG } from '../../src/core/rng.js';
import { runScenario, reductionDb, type ScenarioConfig } from '../../src/core/scenario.js';

const base: ScenarioConfig = {
  seed: 42,
  towerSeparationMeters: 20,
  zoneSeparationMeters: 30,
  sampleCount: 160000,
  mu: 0.05,
};

describe('reductionDb', () => {
  test('10× smaller closed-loop RMS → 20 dB', () => {
    const open = new Float32Array(1000).fill(1);
    const closed = new Float32Array(1000).fill(0.1);
    expect(reductionDb(open, closed)).toBeCloseTo(20, 1);
  });
});

describe('runScenario (two-tower, fiber-relayed)', () => {
  test('seeded scenario → ≥12 dB quiet-zone reduction', () => {
    const r = runScenario(base);
    expect(r.reductionDb).toBeGreaterThanOrEqual(12);
  });

  test('determinism — identical config → identical output arrays and metric', () => {
    const a = runScenario(base);
    const b = runScenario(base);
    expect(a.reductionDb).toBe(b.reductionDb);
    expect(Array.from(a.closedLoop)).toEqual(Array.from(b.closedLoop));
  });

  test('fiber lead advantage — removing the lead worsens zone residual', () => {
    const withLead = runScenario(base);
    const withoutLead = runScenario({ ...base, modelFiberLead: false });
    expect(withLead.reductionDb).toBeGreaterThan(withoutLead.reductionDb);
    // magnitude pins: the "much worse without" headline must hold, not just strict inequality
    expect(withoutLead.reductionDb).toBeLessThan(6);
    expect(withLead.reductionDb - withoutLead.reductionDb).toBeGreaterThan(8);
  });

  test('throws when standoff is too small for a physical secondary path', () => {
    expect(() => runScenario({ ...base, arrayStandoffMeters: 0.01 })).toThrow();
  });

  test('throws when the tower reference lead cannot cover the alignment', () => {
    expect(() => runScenario({ ...base, towerSeparationMeters: 26 })).toThrow(/lead|align/i);
  });

  test('external sourceSignal: deterministic and cancellable (e.g. a real recording)', () => {
    // synthetic "recording": low-passed rng noise bed over a 90 Hz tone (deliberately not a sine)
    const rng = createRng(5);
    let lp = 0;
    let amb = 0;
    const sig = new Float32Array(720000);
    for (let i = 0; i < sig.length; i++) {
      lp += 0.02 * (rng.nextFloat() * 2 - 1 - lp);
      amb = 0.998 * amb + 0.002 * lp;
      sig[i] = 0.5 * Math.sin((2 * Math.PI * 90 * i) / CONFIG.SIM_SAMPLE_RATE) + amb * 2;
    }
    const a = runScenario({ ...base, sampleCount: 720000, sourceSignal: sig });
    const b = runScenario({ ...base, sampleCount: 720000, sourceSignal: sig });
    expect(a.reductionDb).toBe(b.reductionDb);
    expect(a.reductionDb).toBeGreaterThanOrEqual(6);
    // pin: the open-loop zone noise is the PROVIDED signal propagated (30 m → gain 0.25), not the synthetic traffic
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    const burnIn = 16000;
    const zoneRms = rms(a.openLoop.subarray(burnIn));
    const sigRms = rms(sig.subarray(0, 176000)); // matched window (burn-in offset + propagation ≈ 1396 samples)
    expect(zoneRms / sigRms).toBeCloseTo(0.25, 1);
  });
});