import type { ScenarioConfig } from '../core/scenario.js';
import { CONFIG } from '../core/rng.js';

/** Top-down world rectangle: road is the left edge (x = 0), everything in meters. */
export const WORLD = { widthMeters: 60, heightMeters: 40 };

export type Geometry = {
  /** Sensor tower distance from road (m, x axis). */
  towerMeters: number;
  /** Quiet-zone distance from road (m, x axis). */
  zoneMeters: number;
  /** Cancel-array standoff from the zone (m). */
  standoffMeters: number;
  /** Corridor height in world fraction [0,1] (y axis position). */
  y: number;
  /** Traffic level multiplier (0.5 heavy-slowed … 2 heavy traffic). */
  trafficLevel: number;
};

/** Fiber-lead advantage in ms: (zone − tower − standoff) / SPEED_OF_SOUND. */
export function leadMs(g: Geometry): number {
  return ((g.zoneMeters - g.towerMeters - g.standoffMeters) / CONFIG.SPEED_OF_SOUND) * 1000;
}

export type Validated = { ok: true; message?: string } | { ok: false; message: string };

/** Feasibility + bounds check for interactive edits. Mirrors runScenario's throws; used to pre-filter in the UI. */
export function validateGeometry(g: Geometry): Validated {
  if (g.towerMeters <= 0 || g.towerMeters >= WORLD.widthMeters)
    return { ok: false, message: `Tower must sit between 0 and ${WORLD.widthMeters} m from the road` };
  if (g.zoneMeters <= 0 || g.zoneMeters > WORLD.widthMeters)
    return { ok: false, message: `Zone must sit between 0 and ${WORLD.widthMeters} m from the road` };
  if (g.standoffMeters < 0.5)
    return { ok: false, message: `Cancel array must keep ≥ 0.5 m from the zone` };
  // alignment the emission scheduler needs: sound must get from tower side of array to zone before the ambient wavefront does
  const leadSamples = Math.round((g.zoneMeters / CONFIG.SPEED_OF_SOUND) * CONFIG.SIM_SAMPLE_RATE);
  const towerSamples = Math.round((g.towerMeters / CONFIG.SPEED_OF_SOUND) * CONFIG.SIM_SAMPLE_RATE);
  const standoffSamples = Math.round((g.standoffMeters / CONFIG.SPEED_OF_SOUND) * CONFIG.SIM_SAMPLE_RATE);
  const alignment = leadSamples - towerSamples - standoffSamples;
  if (g.towerMeters > 4 && alignment < 0) {
    const minTower = ((leadSamples - standoffSamples) / CONFIG.SIM_SAMPLE_RATE) * CONFIG.SPEED_OF_SOUND;
    return {
      ok: false,
      message: `Infeasible lead: raise tower separation to ≥ ${minTower.toFixed(1)} m for this zone distance`,
    };
  }
  return { ok: true };
}

/** Interactive geometry → scenario config (exact threading, mu derived from traffic level). */
export function geometryToScenarioConfig(
  g: Geometry,
  base: { seed: number; sampleCount: number },
): ScenarioConfig {
  return {
    seed: base.seed,
    sampleCount: base.sampleCount,
    towerSeparationMeters: g.towerMeters,
    zoneSeparationMeters: g.zoneMeters,
    arrayStandoffMeters: g.standoffMeters,
    mu: Math.max(0.01, 0.05 / Math.max(g.trafficLevel, 0.25)),
  };
}