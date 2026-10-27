import { describe, expect, test } from 'vitest';
import { CONFIG } from '../../src/core/rng.js';
import { waveIntensity, zoneDepthDb, type Geometry } from '../../src/ui/fieldViz.js';

const geo: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1 };
const CORRIDOR_Y = 20; // world center (WORLD.heightMeters = 40)

describe('waveIntensity', () => {
  test('on the corridor axis, anti-wave cancels the ambient at the zone point (any frequency)', () => {
    for (const f of [63, 100, 315]) {
      const r = waveIntensity(geo.zoneMeters, CORRIDOR_Y, geo, CORRIDOR_Y, f);
      expect(Math.abs(r.sum)).toBeLessThan(0.02);
    }
  });

  test('deep rumble (63–100 Hz): residual stays small well off-axis (broad quiet region)', () => {
    for (const f of [63, 100]) {
      const off = 2 + CONFIG.SPEED_OF_SOUND / f / 8; // 1/8 wavelength sideways
      const r = waveIntensity(geo.zoneMeters, CORRIDOR_Y + off, geo, CORRIDOR_Y, f);
      expect(Math.abs(r.sum)).toBeLessThan(0.35);
    }
  });

  test('high frequency (315 Hz): residual grows off-axis (quiet zone shrinks — wavelength cap)', () => {
    const off = 2 + CONFIG.SPEED_OF_SOUND / 315 / 8;
    const on = waveIntensity(geo.zoneMeters, CORRIDOR_Y, geo, CORRIDOR_Y, 315);
    const offV = waveIntensity(geo.zoneMeters, CORRIDOR_Y + off, geo, CORRIDOR_Y, 315);
    expect(Math.abs(offV.sum)).toBeGreaterThan(2 * Math.abs(on.sum));
  });
});

describe('zoneDepthDb', () => {
  test('sweep across ±1.5λ: deep rumble cancels deeper than high frequency (more negative dB)', () => {
    const low = zoneDepthDb(geo, CORRIDOR_Y, 100);
    const high = zoneDepthDb(geo, CORRIDOR_Y, 315);
    expect(low).toBeLessThan(high);
  });
});