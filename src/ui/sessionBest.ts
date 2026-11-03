import type { Geometry } from './geometry.js';

export type BestEntry = { db: number; geometry: Geometry };

const clone = (g: Geometry): Geometry => ({ ...g, ...(g.spacingMeters !== undefined ? { spacingMeters: g.spacingMeters } : {}) });

export function createSessionBest() {
  let best: BestEntry | null = null;
  return {
    consider(db: number, geometry: Geometry): void {
      if (!best || db > best.db || !Number.isFinite(best.db)) best = { db, geometry: clone(geometry) };
    },
    current(): BestEntry | null {
      return best ? { db: best.db, geometry: clone(best.geometry) } : null;
    },
    restore(): Geometry | null {
      return best ? clone(best.geometry) : null;
    },
    reset(): void {
      best = null;
    },
    label(): string {
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