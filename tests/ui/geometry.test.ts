import { describe, expect, test } from 'vitest';
import {
  validateGeometry,
  leadMs,
  geometryToScenarioConfig,
  WORLD,
  type Geometry,
} from '../../src/ui/geometry.js';

const VALID: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1 };

describe('geometry mapping', () => {
  test('lead formula = (zone − tower − standoff) / 343 s', () => {
    expect(leadMs(VALID)).toBeCloseTo(((30 - 20 - 5) / 343) * 1000, 1);
  });

  test('validateGeometry: feasible config ok with positive lead', () => {
    const v = validateGeometry(VALID);
    expect(v.ok).toBe(true);
    expect(v.message ?? '').toBe('');
  });

  test('validateGeometry: infeasible lead (tower too close to road for the zone) rejected with guidance', () => {
    const v = validateGeometry({ ...VALID, towerMeters: 26, zoneMeters: 30, standoffMeters: 5 });
    expect(v.ok).toBe(false);
    expect(v.message).toMatch(/lead/i);
  });

  test('validateGeometry: bounds — zone, tower, standoff stay within world extents', () => {
    expect(validateGeometry({ ...VALID, zoneMeters: 999 }).ok).toBe(false);
    expect(validateGeometry({ ...VALID, towerMeters: -1 }).ok).toBe(false);
    expect(validateGeometry({ ...VALID, standoffMeters: 0 }).ok).toBe(false);
  });

  test('geometryToScenarioConfig: exact values threaded', () => {
    const cfg = geometryToScenarioConfig(VALID, { seed: 42, sampleCount: 160000 });
    expect(cfg.towerSeparationMeters).toBe(20);
    expect(cfg.zoneSeparationMeters).toBe(30);
    expect(cfg.arrayStandoffMeters).toBe(5);
    expect(cfg.seed).toBe(42);
    expect(cfg.sampleCount).toBe(160000);
    expect(cfg.mu).toBeGreaterThan(0);
  });
});

describe('WORLD', () => {
  test('world extents cover the default geometry', () => {
    expect(WORLD.widthMeters).toBeGreaterThanOrEqual(VALID.zoneMeters + VALID.standoffMeters + 2);
    expect(WORLD.heightMeters).toBeGreaterThan(0);
  });
});