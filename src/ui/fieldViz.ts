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

/** Low-res heat buffer — reused across repains so scaling stays smooth. */
const heatBuf: { cv: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null } = { cv: null, ctx: null };

/* Heat field styles (no continuous fades — user finding: fades over the meadow smear and strain):
 * 'contour' = flat posterized bands + crisp outline around the destructive region (the real
 *   "this area hears cancellation" boundary — the most meaningful line on the map)
 * 'flat'    = same posterized bands, no outlines
 * legacy    = old alpha-fade field (kept for A/B; not linked from UI) */
type HeatStyle = 'contour' | 'flat' | 'legacy';
/** Heat style — default 'contour' (user pick): sparse posterized pools + the destructive-region
 *  outline. 'flat' = pools only; 'legacy' = the old alpha fade (kept for on-camera A/B). */
export function heatStyle(): HeatStyle {
  try {
    const s = new URLSearchParams(window.location.search).get('style');
    return s === 'flat' || s === 'legacy' ? s : 'contour';
  } catch {
    return 'contour';
  }
}

/** Flat alpha steps for the posterized field — SPARSE on purpose: only regions with genuinely
 *  strong interference get paint; the meadow stays clean where nothing meaningful happens. */
function posterStep(v: number, loud: boolean): number {
  const steps: number[] = loud ? [0.12, 0.24] : [0.18, 0.34];
  const t = v > 0.6 ? 1 : v > 0.38 ? 0 : -1;
  return t === -1 ? 0 : steps[t];
}

/** Marching squares on a {0,1} sign grid — hairline segments of the destructive-region boundary. */
export function quietContours(mask: { grid: Uint8Array; w: number; h: number }): Array<[number, number, number, number]> {
  const segs: Array<[number, number, number, number]> = [];
  const at = (c: number, r: number): number => (c < 0 || r < 0 || c >= mask.w || r >= mask.h) ? 0 : mask.grid[r * mask.w + c];
  for (let r = 0; r < mask.h; r++) {
    for (let c = 0; c < mask.w; c++) {
      const tl = at(c, r), tr = at(c + 1, r), bl = at(c, r + 1), br = at(c + 1, r + 1);
      const code = (tl << 3) | (tr << 2) | (br << 1) | bl;
      const x = c + 0.5, y = r + 0.5; // mid-edge segments are fine at hairline scale
      const push = (x1: number, y1: number, x2: number, y2: number): void => { segs.push([x1, y1, x2, y2]); };
      switch (code) {
        case 0b1000: push(x - 0.5, y, x, y - 0.5); break;
        case 0b0100: push(x, y - 0.5, x + 0.5, y); break;
        case 0b0010: push(x + 0.5, y, x, y + 0.5); break;
        case 0b0001: push(x, y + 0.5, x - 0.5, y); break;
        case 0b1100: push(x, y - 0.5, x, y + 0.5); break;
        case 0b0110: push(x - 0.5, y, x + 0.5, y); break;
        case 0b0011: push(x - 0.5, y, x, y + 0.5); break;
        case 0b1001: push(x, y - 0.5, x - 0.5, y); break;
        case 0b0111: push(x, y - 0.5, x - 0.5, y); break;
        case 0b1101: push(x - 0.5, y, x, y + 0.5); break;
        case 0b1110: push(x + 0.5, y, x, y + 0.5); break;
        case 0b1011: push(x, y - 0.5, x + 0.5, y); break;
        case 0b0101: case 0b1010: // saddle: both verticals (visual continuity beats a choice here)
          push(x, y - 0.5, x, y + 0.5); break;
      }
    }
  }
  return segs;
}

/* ---- heat palette (validated with the dataviz palette validator vs the meadow surface) ----
 * diverging polarity: destructive (quiet) pole, constructive (louder) pole; magnitude lives in alpha. */
export const HEAT_PALETTES = {
  a: { quiet: [69, 105, 184], loud: [217, 126, 102], name: 'calm blue / soft coral' },
  b: { quiet: [69, 105, 184], loud: [194, 92, 142], name: 'calm blue / plum' },
  c: { quiet: [42, 72, 118], loud: [190, 160, 90], name: 'deep pools / sand' },
  d: { quiet: [79, 209, 197], loud: [240, 120, 90], name: 'classic (previous)' },
} as const;
export type HeatPaletteKey = keyof typeof HEAT_PALETTES;

function heatColorKey(): { key: HeatPaletteKey; rgb: { quiet: readonly number[]; loud: readonly number[] }; quietA: number; loudA: number } {
  try {
    const q = new URLSearchParams(window.location.search).get('palette');
    const key = (q && q in HEAT_PALETTES ? q : 'a') as HeatPaletteKey;
    const rgb = HEAT_PALETTES[key];
    // the modern pairs paint softer; the classic pair keeps its old alphas for a fair A/B
    const quietA = key === 'd' ? 0.55 : 0.5;
    const loudA = key === 'd' ? 0.35 : 0.3;
    return { key, rgb, quietA, loudA };
  } catch {
    return { key: 'a', rgb: HEAT_PALETTES.a, quietA: 0.5, loudA: 0.3 };
  }
}

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

  // map text must read over BOTH the dark UI and the light meadow — dark rim + near-white fill
  const textSharp = (txt: string, x: number, y: number, fill = '#f4f7fb', font = '11px sans-serif'): void => {
    c2d.save();
    c2d.font = font;
    c2d.lineWidth = 3;
    c2d.strokeStyle = 'rgba(13,16,23,0.85)';
    c2d.shadowColor = 'rgba(13,16,23,0.9)';
    c2d.shadowBlur = 3;
    c2d.strokeText(txt, x, y);
    c2d.shadowBlur = 0;
    c2d.fillStyle = fill;
    c2d.fillText(txt, x, y);
    c2d.restore();
  };

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
    textSharp('green pools + trees: protected areas derived from the analyzed photo (stylized)', roadPx + 10, 16);
  }

  // heat-map field at the chosen frequency — three styles: contour (flat bands + destructive-region
  // outline), flat (bands only), legacy (the old alpha fade). Posterization kills the smear.
  const { rgb: pal, quietA, loudA } = heatColorKey();
  const style = heatStyle();
  const lam = CONFIG.SPEED_OF_SOUND / FREQ;
  const pxPerMeter = w / WORLD.widthMeters;
  const step = Math.max(2, Math.round((lam * pxPerMeter) / 10));
  const cols = Math.ceil(w / step);
  const rows = Math.ceil(stripTop / step);
  if (!heatBuf.cv) heatBuf.cv = document.createElement('canvas');
  const cv = heatBuf.cv as HTMLCanvasElement;
  if (cv.width !== cols || cv.height !== rows) {
    cv.width = cols;
    cv.height = rows;
    heatBuf.ctx = cv.getContext('2d');
  }
  const hctx = heatBuf.ctx;
  if (hctx) {
    const img = hctx.createImageData(cols, rows);
    const mask = { grid: new Uint8Array(cols * rows), w: cols, h: rows };
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const xm = ((col + 0.5) * step / w) * WORLD.widthMeters;
        const ym = ((row + 0.5) * step / stripTop) * WORLD.heightMeters;
        const { sum } = waveIntensity(xm, ym, geo, (corridorY / stripTop) * WORLD.heightMeters, FREQ);
        const a = Math.min(Math.abs(sum) * 2.4, 1);
        const [r, g, b] = sum <= 0 ? pal.quiet : pal.loud;
        const alpha = style === 'legacy' ? a * (sum <= 0 ? quietA : loudA) : posterStep(a, sum > 0);
        if (style !== 'legacy' && sum <= 0 && posterStep(a, false) > 0) mask.grid[row * cols + col] = 1; // strong quiet pockets only
        const i = (row * cols + col) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = alpha * 255;
      }
    }
    hctx.putImageData(img, 0, 0);
    // poster style: hard pixel blocks (smoothing OFF); legacy: bilinear soft
    c2d.imageSmoothingEnabled = style === 'legacy';
    if (style === 'legacy') c2d.imageSmoothingQuality = 'high';
    c2d.drawImage(cv, 0, 0, cols, rows, 0, 0, cols * step, rows * step);
    if (style === 'contour') {
      // the one meaningful line: the boundary of the region that hears cancellation
      const segs = quietContours(mask);
      c2d.strokeStyle = 'rgba(13,16,23,0.45)';
      c2d.lineWidth = 1;
      c2d.beginPath();
      for (const [x1, y1, x2, y2] of segs) {
        c2d.moveTo((x1 * step), (y1 * step));
        c2d.lineTo((x2 * step), (y2 * step));
      }
      c2d.stroke();
      c2d.strokeStyle = `rgba(${pal.quiet[0]},${pal.quiet[1]},${pal.quiet[2]},0.7)`;
      c2d.beginPath();
      for (const [x1, y1, x2, y2] of segs) {
        c2d.moveTo((x1 * step) - 0.3, (y1 * step));
        c2d.lineTo((x2 * step) - 0.3, (y2 * step));
      }
      c2d.stroke();
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
    textSharp(label, px + 13, py + (above ? -12 : 20), '#f4f7fb', 'bold 12px sans-serif');
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
    // the band paints in the palette's quiet pole — visible over the meadow, consistent with the contour pools
    const [qr, qg, qb] = pal.quiet;
    c2d.fillStyle = `rgba(${qr},${qg},${qb},0.2)`;
    c2d.fillRect(speakerX, nodeY - half, w - speakerX, half * 2);
  }
  // union outline + width number — the node/spacing effect, measurable at a glance
  const unionHalf = ((spacingOf(geo) * (geo.speakers - 1)) / 2 + lam * 0.75) * yScale;
  const [ur, ug, ub] = pal.quiet;
  c2d.strokeStyle = `rgba(${ur},${ug},${ub},0.9)`;
  c2d.lineWidth = 2;
  c2d.strokeRect(speakerX, corridorY - unionHalf, w - speakerX, unionHalf * 2);
  const bandWm = quietBandMeters(geo, FREQ);
  textSharp(
    `quiet band ≈ ${bandWm.toFixed(1)} m (${geo.speakers} node${geo.speakers > 1 ? 's' : ''} @ ${spacingOf(geo).toFixed(0)} m)`,
    speakerX + 8,
    Math.max(corridorY - unionHalf - 28, 16), // clear of the marker labels below
  );
  for (const off of nodeOffsets(geo)) {
    marker(speakerX, corridorY + off * yScale, 'Array', '#4fd1c5', opts.highlight === 'speaker', off >= 0);
  }
  marker(zx, corridorY, 'Quiet zone', '#e0705a', opts.highlight === 'zone', true);

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
  textSharp('cross-section at the corridor line:', 12, stripTop - 8, '#f4f7fb', 'bold 11px sans-serif');
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