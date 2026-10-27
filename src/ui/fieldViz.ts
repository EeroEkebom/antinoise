import { CONFIG } from '../core/rng.js';
import { WORLD, leadMs, type Geometry } from './geometry.js';

export type Marker = 'tower' | 'speaker' | 'zone';

const FREQ_HZ = 100; // demo center frequency (deep rumble); honest wavelength label drawn
const ROADM = 6; // road band width, meters

/** meters → canvas x */
const mx = (m: number, w: number) => (m / WORLD.widthMeters) * w;

/** analytic superposition intensity: line-source road noise + antiphase speaker wave, summed magnitude. */
function intensity(xm: number, ym: number, geo: Geometry, corridorY: number): number {
  const c = CONFIG.SPEED_OF_SOUND;
  const dRoad = Math.max(xm - ROADM, 0.3);
  const d = (m: number) => Math.max(Math.abs(ym - corridorY) + Math.max(m - ROADM, 0) * 0.001, 0.3);
  void d;
  // distance from road line (perpendicular) — line source falloff 1/sqrt(dist)
  const amb = (0.55 / Math.sqrt(dRoad)) * Math.sin((2 * Math.PI * FREQ_HZ * (xm - ROADM)) / c);
  // speaker antiphase wave: radial distance from the speaker position (m)
  const sx = geo.zoneMeters - geo.standoffMeters;
  const dx = xm - sx;
  const dy = ym - corridorY;
  const dS = Math.max(Math.hypot(dx, dy), 0.3);
  const anti = (0.55 / Math.sqrt(Math.max(sx - ROADM, 0.3))) * Math.sin((2 * Math.PI * FREQ_HZ * dS) / c + Math.PI);
  return Math.abs(amb + anti);
}

/** Full repaint: recomputes the field texture (call on geometry change / re-run only, not per frame). */
export function renderField(
  canvas: HTMLCanvasElement,
  geo: Geometry,
  opts: { highlight?: Marker | null; infeasible?: string | null } = {},
): void {
  const c2d = canvas.getContext('2d');
  if (!c2d) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  c2d.setTransform(dpr, 0, 0, dpr, 0, 0);

  const corridorY = (WORLD.heightMeters / 2) * (h / WORLD.heightMeters);

  // heat-map field (step 4px for frame budget)
  const img = c2d.createImageData(w, h);
  const step = 4;
  for (let py = 0; py < h; py += step) {
    for (let px = 0; px < w; px += step) {
      const xm = (px / w) * WORLD.widthMeters;
      const ym = (py / h) * WORLD.heightMeters;
      const v = intensity(xm, ym, geo, corridorY);
      const a = Math.min(v * 2.2, 1); // intensity → alpha (single accent hue)
      c2d.fillStyle = `rgba(79, 209, 197, ${a * 0.55})`;
      c2d.fillRect(px, py, step, step);
    }
  }
  // note: fillRect loop above paints; the ImageData allocated is unused — drop
  void img;

  // road band
  c2d.fillStyle = '#2a3140';
  c2d.fillRect(0, 0, Math.ceil(mx(ROADM, w)), h);
  c2d.fillStyle = '#e6a23c';
  for (let y = 8; y < h; y += 26) c2d.fillRect(Math.ceil(mx(ROADM / 3, w)), y, 2, 14);

  // quiet-zone honest extent circle (λ-capped extent at FREQ_HZ)
  const lam = CONFIG.SPEED_OF_SOUND / FREQ_HZ;
  const zx = mx(geo.zoneMeters, w);
  const zy = corridorY;
  c2d.strokeStyle = 'rgba(79,209,197,0.35)';
  c2d.setLineDash([4, 4]);
  c2d.beginPath();
  c2d.arc(zx, zy, mx(lam * 1.5, w), 0, Math.PI * 2);
  c2d.stroke();
  c2d.setLineDash([]);

  // markers
  const marker = (px: number, py: number, label: string, color: string, hl: boolean): void => {
    c2d.beginPath();
    c2d.arc(px, py, hl ? 11 : 8, 0, Math.PI * 2);
    c2d.fillStyle = color;
    c2d.fill();
    c2d.font = '12px sans-serif';
    c2d.fillStyle = '#d9dee8';
    c2d.fillText(label, px + 14, py + 4);
  };
  const towerX = mx(geo.towerMeters, w);
  const speakerX = mx(geo.zoneMeters - geo.standoffMeters, w);
  marker(towerX, zy, 'Sensor tower → fiber → controller', '#7f8ff4', opts.highlight === 'tower');
  marker(speakerX, zy, 'Cancel array', '#4fd1c5', opts.highlight === 'speaker');
  marker(zx, zy, 'Quiet zone', '#e0705a', opts.highlight === 'zone');

  // fiber link visual (tower → controller co-located at speaker side): instant line
  c2d.strokeStyle = 'rgba(127,143,244,0.7)';
  c2d.setLineDash([2, 3]);
  c2d.beginPath();
  c2d.moveTo(towerX, zy + 14);
  c2d.lineTo(speakerX, zy + 14);
  c2d.stroke();
  c2d.setLineDash([]);

  // infeasibility overlay
  if (opts.infeasible) {
    c2d.fillStyle = 'rgba(224, 112, 90, 0.12)';
    c2d.fillRect(0, 0, w, h);
  }

  // scale honesty note
  c2d.fillStyle = 'rgba(217,222,232,0.75)';
  c2d.font = '11px sans-serif';
  c2d.fillText(
    `field view @ ${FREQ_HZ} Hz · λ = ${lam.toFixed(1)} m caps the honest zone extent · lead ${leadMs(geo).toFixed(0)} ms`,
    12,
    h - 10,
  );
}

/** Nearest marker to a canvas point (screen px), for drag hit-testing. */
export function hitTest(
  canvas: HTMLCanvasElement,
  geo: Geometry,
  px: number,
  py: number,
): Marker | null {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const corridorY = (WORLD.heightMeters / 2) * (h / WORLD.heightMeters);
  const pts: [Marker, number][] = [
    ['tower', mx(geo.towerMeters, w)],
    ['speaker', mx(geo.zoneMeters - geo.standoffMeters, w)],
    ['zone', mx(geo.zoneMeters, w)],
  ];
  let best: Marker | null = null;
  let bestD = 30;
  for (const [m, x] of pts) {
    const d = Math.hypot(x - px, corridorY - py);
    if (d < bestD) {
      best = m;
      bestD = d;
    }
  }
  return best;
}

/** Canvas px → meters (x only; drags are constrained to the corridor axis). */
export function pxToMeters(px: number, canvasWidth: number): number {
  return (px / canvasWidth) * WORLD.widthMeters;
}