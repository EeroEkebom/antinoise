import type { Geometry } from './geometry.js';

export type BestEntry = { db: number; geometry: Geometry };

const clone = (g: Geometry): Geometry => ({ ...g, ...(g.spacingMeters !== undefined ? { spacingMeters: g.spacingMeters } : {}) });

// Session best is per traffic source: each source (synthetic / real recording) keeps
// its own best, because dB numbers are only comparable within one source.
export function createSessionBest() {
  let bests = new Map<string, BestEntry>();
  return {
    consider(db: number, geometry: Geometry, sourceKey: string): void {
      const best = bests.get(sourceKey);
      if (!best || db > best.db || !Number.isFinite(best.db)) bests.set(sourceKey, { db, geometry: clone(geometry) });
    },
    current(sourceKey: string): BestEntry | null {
      const best = bests.get(sourceKey);
      return best ? { db: best.db, geometry: clone(best.geometry) } : null;
    },
    restore(sourceKey: string): Geometry | null {
      return bests.get(sourceKey) ? clone(bests.get(sourceKey)!.geometry) : null;
    },
    reset(): void {
      bests = new Map();
    },
    label(sourceKey: string): string {
      const best = bests.get(sourceKey);
      if (!best) return 'no result yet';
      return `${best.db.toFixed(1)} dB · ${setupLabel(best.geometry)}`;
    },
  };
}

export function setupLabel(g: Geometry): string {
  const parts = [
    `tower ${g.towerMeters.toFixed(0)} m`,
    `zone ${g.zoneMeters.toFixed(0)} m`,
    `array ${g.standoffMeters.toFixed(1)} m`,
    `${g.speakers} nodes`,
  ];
  if (g.spacingMeters !== undefined) parts.push(`spacing ${g.spacingMeters.toFixed(0)} m`);
  return parts.join(' · ');
}