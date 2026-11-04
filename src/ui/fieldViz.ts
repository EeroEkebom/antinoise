import { CONFIG } from '../core/rng.js';
import { WORLD, leadMs, spacingOf, type Geometry } from './geometry.js';

export type Marker = 'tower' | 'speaker' | 'zone';

const ROADM = 6; // road band width, meters
const AMP = 0.55; // nominal source amplitude at the road edge

/** meters → canvas x */
const mx = (m: number, w: number) => (m / WORLD.widthMeters) * w;

export type Wave = { amb: number; anti: number; sum: number };

/** Array node y-offsets: symmetric spread along the corridor, SPEAKER_SPACING_M apart. */
export function nodeOffsets(geo: Geometry): number[] {
  const n = geo.speakers;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(spacingOf(geo) * (k - (n - 1) / 2));
  return out;
}

/** Analytic per-frequency superposition of ALL array nodes at a world point. Each node is
 * amplitude-matched and antiphase at its own band node (the emission scheduler's job), giving
 * real diverging waves; their union widens the honest quiet band. */
export function waveIntensity(
  xm: number,
  ym: number,
  geo: Geometry,
  corridorY: number,
  freqHz: number,
): Wave {
  const c = CONFIG.SPEED_OF_SOUND;
  const w = 2 * Math.PI * freqHz;
  const dRoad = Math.max(xm - ROADM, 0.3);
  const amb = (AMP / Math.sqrt(dRoad)) * Math.sin((w * dRoad) / c);

  const sx = geo.zoneMeters - geo.standoffMeters;
  const dRoadZone = Math.max(geo.zoneMeters - ROADM, 0.3);
  const dZ = Math.max(geo.standoffMeters, 0.3);
  const ampA = (AMP * Math.sqrt(dZ)) / Math.sqrt(dRoadZone); // amplitude matched at each node
  const phaseRef = (w * (dRoadZone - dZ)) / c + Math.PI; // scheduler: antiphase on arrival at the node
  let anti = 0;
  for (const off of nodeOffsets(geo)) {
    const dS = Math.max(Math.hypot(xm - sx, ym - (corridorY + off)), 0.3);
    // directive node: aimed at its own band — suppresses crosstalk into neighbouring nodes (BEAM=8 ≈ cardioid)
    const cosA = (xm - sx) / dS;
    const beam = cosA > 0 ? Math.pow(cosA, BEAM) : 0;
    anti += beam * (ampA / Math.sqrt(dS)) * Math.sin((w * dS) / c + phaseRef);
  }
  return { amb, anti, sum: amb + anti };
}

const BEAM = 8;

/** Quiet-zone "depth": residual sum swept perpendicular across the band the array actually covers
 * (±(node span)/2 + 0.75λ), dB vs ambient alone. */
export function zoneDepthDb(geo: Geometry, corridorY: number, freqHz: number): number {
  const lam = CONFIG.SPEED_OF_SOUND / freqHz;
  const span = (spacingOf(geo) * (geo.speakers - 1)) / 2 + lam * 0.75;
  let sAmb = 0;
  let sSum = 0;
  const n = 64;
  for (let i = 0; i < n; i++) {
    const ym = corridorY + span * ((i / (n - 1)) * 2 - 1);
    const r = waveIntensity(geo.zoneMeters, ym, geo, corridorY, freqHz);
    sAmb += r.amb * r.amb;
    sSum += r.sum * r.sum;
  }
  return 20 * Math.log10(Math.sqrt(sAmb / n) / Math.sqrt(Math.max(sSum / n, 1e-12)));
}

/** Width, in meters, of the honest quiet band printed on the map and fed to the agent:
 *  the union of the array nodes' quiet bands at that frequency. */
export function quietBandMeters(geo: Geometry, freqHz: number): number {
  const lam = CONFIG.SPEED_OF_SOUND / freqHz;
  return spacingOf(geo) * (geo.speakers - 1) + lam * 1.5;
}

/* ---- photo-derived accents (styling only) ---- */

/** Protected areas (open ground / sidewalk boxes) SAM found in the analyzed street photo,
 *  normalized to the frame. Positions of the quiet patches on the map: along-the-road
 *  placement from the photo's relative x, at the corridor midline. Stylized — not photogrammetry. */
export type PhotoDerived = { boxes: Array<{ x1: number; y1: number; x2: number; y2: number }>; frameW: number; frameH: number };

/** Patch centers in METERS for the map: photo fx 0..1 (as seen along the road) → corridor x 8..56 m.
 *  Pure + tested; renderField draws the pretty part around these. */
export function photoPatchPositions(derived: PhotoDerived, geo: Geometry): Array<{ xm: number; ym: number }> {
  const maxAlong = Math.max(geo.zoneMeters, 20);
  return derived.boxes.map((b) => {
    const cx = (b.x1 + b.x2) / 2 / derived.frameW;
    return { xm: 8 + Math.min(Math.max(cx, 0), 1) * Math.max(maxAlong - 16, 0), ym: WORLD.heightMeters / 2 };
  });
}

// the generated backdrop's own painted road ends here (fraction of its width) — we crop it out
// so the scale-honest 6 m road band drawn by the app is the ONLY road on the map
const TEXTURE_ROAD_END = 0.185;

/** Full repaint: field heat-map + 1D cross-section strip. Call on geometry/frequency change only. */
export function renderField(
  canvas: HTMLCanvasElement,
  geo: Geometry,
  opts: {
    highlight?: Marker | null;
    infeasible?: string | null;
    freqHz: number;
    texture?: HTMLImageElement | null;
    photoDerived?: PhotoDerived | null;
  } = { freqHz: 100 },
): void {
  const c2d = canvas.getContext('2d');
  if (!c2d) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  c2d.setTransform(dpr, 0, 0, dpr, 0, 0);

  const FREQ = opts.freqHz;
  const corridorY = h / 2; // drawing coords: corridor midline
  const stripTop = Math.round(h * 0.78);
  const stripH = h - stripTop - 24;

  const roadPx = Math.ceil(mx(ROADM, w));

  // Meta muse-image-1.0 backdrop (cropped past its own road; the app's road band follows)
  const tex = opts.texture;
  if (tex && tex.complete && tex.naturalWidth > 0) {
    const sx = tex.naturalWidth * TEXTURE_ROAD_END;
    c2d.drawImage(tex, sx, 0, tex.naturalWidth - sx, tex.naturalHeight, roadPx + 2, 0, w - roadPx - 2, stripTop);
  }

  // photo-derived protected-area patches (before the heat so the data layer stays on top)
  if (opts.photoDerived) {
    for (const p of photoPatchPositions(opts.photoDerived, geo)) {
      const px = mx(p.xm, w);
      const py = (p.ym / WORLD.heightMeters) * stripTop;
      const g = c2d.createRadialGradient(px, py, 4, px, py, 34);
      g.addColorStop(0, 'rgba(140,200,135,0.5)');
      g.addColorStop(1, 'rgba(140,200,135,0)');
      c2d.fillStyle = g;
      c2d.fillRect(px - 34, py - 34, 68, 68);
      // a little tree on the pool — readable at a glance, stylized like the backdrop
      c2d.fillStyle = 'rgba(96,150,90,0.85)';
      c2d.beginPath();
      c2d.arc(px, py, 6, 0, Math.PI * 2);
      c2d.fill();
      c2d.fillStyle = 'rgba(13,16,23,0.55)';
      c2d.fillRect(px - 1, py + 4, 2, 7);
    }
    c2d.fillStyle = 'rgba(217,222,232,0.75)';
    c2d.font = '10px sans-serif';
    c2d.fillText('green pools + trees: protected areas derived from the analyzed photo (stylized)', roadPx + 10, 16);
  }

  // heat-map field at the chosen frequency, adaptive step (λ in pixels)
  const lam = CONFIG.SPEED_OF_SOUND / FREQ;
  const pxPerMeter = w / WORLD.widthMeters;
  const step = Math.max(2, Math.round((lam * pxPerMeter) / 10));
  for (let py = 0; py < stripTop; py += step) {
    for (let px = 0; px < w; px += step) {
      const xm = (px / w) * WORLD.widthMeters;
      const ym = (py / stripTop) * WORLD.heightMeters;
      const { sum } = waveIntensity(xm, ym, geo, (corridorY / stripTop) * WORLD.heightMeters, FREQ);
      const a = Math.min(Math.abs(sum) * 2.4, 1);
      c2d.fillStyle = sum <= 0 ? `rgba(79,209,197,${a * 0.55})` : `rgba(240,120,90,${a * 0.35})`;
      c2d.fillRect(px, py, step, step);
    }
  }

  // road band (scale-honest: this strip IS the 6 m road; the backdrop's texture road is cropped away)
  c2d.fillStyle = '#2a3140';
  c2d.fillRect(0, 0, roadPx, stripTop);
  c2d.fillStyle = '#e6a23c';
  for (let y = 8; y < stripTop; y += 26) c2d.fillRect(Math.ceil(mx(ROADM / 3, w)), y, 2, 14);

  const hexA = (hx: string, a: string): string => `${hx}${a}`; // 6-digit hex → 8-digit hex with alpha
  const marker = (px: number, py: number, label: string, color: string, hl: boolean, above = true): void => {
    // soft halo first — the "cooler" sensor/array/zone look; hl markers get a wider pulse ring
    const r = hl ? 26 : 18;
    const halo = c2d.createRadialGradient(px, py, 2, px, py, r);
    halo.addColorStop(0, hexA(color, '55'));
    halo.addColorStop(1, hexA(color, '00'));
    c2d.fillStyle = halo;
    c2d.beginPath();
    c2d.arc(px, py, r, 0, Math.PI * 2);
    c2d.fill();
    if (hl) {
      c2d.strokeStyle = hexA(color, '88');
      c2d.setLineDash([3, 4]);
      c2d.beginPath();
      c2d.arc(px, py, r - 4, 0, Math.PI * 2);
      c2d.stroke();
      c2d.setLineDash([]);
    }
    c2d.beginPath();
    c2d.arc(px, py, hl ? 11 : 8, 0, Math.PI * 2);
    c2d.fillStyle = color;
    c2d.fill();
    c2d.strokeStyle = 'rgba(13,16,23,0.6)';
    c2d.lineWidth = 2;
    c2d.stroke();
    c2d.lineWidth = 1;
    c2d.font = 'bold 12px sans-serif';
    c2d.fillStyle = '#d9dee8';
    c2d.fillText(label, px + 13, py + (above ? -12 : 20));
  };
  const towerX = mx(geo.towerMeters, w);
  const speakerX = mx(geo.zoneMeters - geo.standoffMeters, w);
  const zx = mx(geo.zoneMeters, w);
  marker(towerX, corridorY, 'Sensor', '#7f8ff4', opts.highlight === 'tower', true);
  // one quiet band per array node — their UNION is the honest quiet zone; visibly wider with more nodes
  const yScale = stripTop / WORLD.heightMeters;
  for (const off of nodeOffsets(geo)) {
    const nodeY = corridorY + off * yScale;
    const half = lam * 0.75 * yScale;
    c2d.fillStyle = 'rgba(79,209,197,0.12)';
    c2d.fillRect(speakerX, nodeY - half, w - speakerX, half * 2);
  }
  // union outline + width number — the node/spacing effect, measurable at a glance
  const unionHalf = ((spacingOf(geo) * (geo.speakers - 1)) / 2 + lam * 0.75) * yScale;
  c2d.strokeStyle = 'rgba(79,209,197,0.7)';
  c2d.lineWidth = 1.5;
  c2d.strokeRect(speakerX, corridorY - unionHalf, w - speakerX, unionHalf * 2);
  c2d.lineWidth = 1;
  c2d.fillStyle = 'rgba(79,209,197,0.9)';
  c2d.font = '11px sans-serif';
  const bandWm = quietBandMeters(geo, FREQ);
  c2d.fillText(`quiet band ≈ ${bandWm.toFixed(1)} m (${geo.speakers} node${geo.speakers > 1 ? 's' : ''} @ ${spacingOf(geo).toFixed(0)} m)`, speakerX + 8, corridorY - unionHalf - 6);
  for (const off of nodeOffsets(geo)) {
    marker(speakerX, corridorY + off * yScale, 'Array', '#4fd1c5', opts.highlight === 'speaker', off >= 0);
  }
  marker(zx, corridorY, 'Zone', '#e0705a', opts.highlight === 'zone', true);

  // fiber link (tower → controller at the array side): effectively instant
  c2d.strokeStyle = 'rgba(127,143,244,0.7)';
  c2d.setLineDash([2, 3]);
  c2d.beginPath();
  c2d.moveTo(towerX, corridorY + 16);
  c2d.lineTo(speakerX, corridorY + 16);
  c2d.stroke();
  c2d.setLineDash([]);

  if (opts.infeasible) {
    c2d.fillStyle = 'rgba(224, 112, 90, 0.12)';
    c2d.fillRect(0, 0, w, stripTop);
  }

  // cross-section strip along the corridor: ambient wave, anti wave, their sum
  c2d.fillText('cross-section at the corridor line:', 12, stripTop - 8);
  const y0 = stripTop + stripH / 2;
  const plot = (getV: (x: number) => number, color: string, lw: number, phaseY = 0): void => {
    c2d.beginPath();
    c2d.strokeStyle = color;
    c2d.lineWidth = lw;
    for (let px = Math.ceil(mx(ROADM, w)); px < w; px++) {
      const v = getV((px / w) * WORLD.widthMeters);
      const py = y0 - v * stripH * 0.42 - phaseY;
      if (px <= Math.ceil(mx(ROADM, w)) + 1) c2d.moveTo(px, py);
      else c2d.lineTo(px, py);
    }
    c2d.stroke();
  };
  plot((x) => waveIntensity(x, corridorY, geo, corridorY, FREQ).amb * 1.6, 'rgba(230,162,60,0.8)', 1.5);
  plot((x) => waveIntensity(x, corridorY, geo, corridorY, FREQ).anti * 1.6, 'rgba(127,143,244,0.9)', 1.5);
  plot((x) => waveIntensity(x, corridorY, geo, corridorY, FREQ).sum * 2.4, '#4fd1c5', 2.5);
  // cancelled region marker on the strip: the sum trough around the zone
  c2d.fillStyle = 'rgba(79,209,197,0.25)';
  c2d.fillRect(mx(geo.zoneMeters - lam * 1.5, w), stripTop + 4, mx(lam * 3, w), stripH - 4);

  // honesty labels
  c2d.fillStyle = 'rgba(217,222,232,0.8)';
  c2d.font = '11px sans-serif';
  const depth = zoneDepthDb(geo, corridorY, FREQ);
  c2d.fillText(
    `@ ${FREQ} Hz · λ = ${lam.toFixed(2)} m · quiet-band depth ≈ ${Number.isFinite(depth) ? depth.toFixed(0) : '—'} dB · lead ${leadMs(geo).toFixed(0)} ms`,
    12,
    h - 8,
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
  const corridorY = canvas.clientHeight / 2;
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