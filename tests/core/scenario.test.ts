import { describe, expect, test } from 'vitest';
import { CONFIG } from '../../src/core/rng.js';
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
  });
});