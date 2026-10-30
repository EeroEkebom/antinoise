/** SAM 3.1 → placement proposal. SAM returns boxes (pixel space); photo proportions map to
 * world meters (the 60 m world width is the honest calibration anchor). Never auto-applied —
 * the UI shows the proposal; the user confirms. */

export type Box = { id: number; frame: number; x1: number; y1: number; x2: number; y2: number; w: number; h: number };

/** Parse the SAM output-lane text: `<Nf>id<|box;...|><|mask;...|>,id...` per frame. */
export function parseSamBoxes(text: string, frame: number | null = null): Box[] {
  const boxes: Box[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith('<')) continue;
    const frameM = /^<(\d+)f>/.exec(line);
    if (!frameM) continue;
    const f = Number(frameM[1]);
    if (frame !== null && f !== frame) continue;
    // records separated by commas at the top level
    for (const record of line.slice(line.indexOf('>') + 1).split(',')) {
      const boxM = /<\|box;([^|]+)\|>/.exec(record);
      if (!boxM) continue;
      const b: Box = { id: 0, frame: f, x1: 0, y1: 0, x2: 0, y2: 0, w: 0, h: 0 };
      const idM = /^(\d+)/.exec(record.trim());
      b.id = idM ? Number(idM[1]) : 0;
      for (const kv of boxM[1].split(';')) {
        const [k, v] = kv.split('=');
        if (k && v !== undefined && k in b) (b as unknown as Record<string, number>)[k] = Number(v);
      }
      if (b.w > 0 && b.x2 > b.x1) boxes.push(b);
    }
  }
  return boxes;
}

export type PlacementProposal = {
  towerMeters: number;
  zoneMeters: number;
  standoffMeters: number;
  speakers: number;
  note: string;
  fallback: boolean;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Road box = the noise side; zone box = the area to protect. Corridor runs perpendicular from the road. */
export function interpretPlacement(
  seg: { road: Box[]; zone: Box[] },
  frameW: number,
  frameH: number,
): PlacementProposal {
  if (seg.road.length === 0) {
    return {
      towerMeters: 20, zoneMeters: 30, standoffMeters: 5, speakers: 3,
      note: 'no road segmentation found — keeping current geometry',
      fallback: true,
    };
  }
  // road band: pick the widest-extent box (the road), principal axis from its dimensions
  const road = seg.road.reduce((a, b) => ((b.x2 - b.x1) + (b.y2 - b.y1) > (a.x2 - a.x1) + (a.y2 - a.y1) ? b : a));
  const horizontalRoad = (road.x2 - road.x1) >= (road.y2 - road.y1);
  // zone anchor = the zone box closest to the road
  const zone = seg.zone.length > 0
    ? seg.zone.reduce((a, b) => (gapMeters(b, road, frameW, frameH) < gapMeters(a, road, frameW, frameH) ? b : a))
    : null;

  // photo → world: road-to-zone gap as a fraction of the frame maps onto the 60 m world
  const WORLD_W = 60;
  const frac = zone ? gapMeters(zone, road, frameW, frameH) / (horizontalRoad ? frameH : frameW) : 0.5;
  const zoneMeters = clamp((0.35 + 0.55 * frac) * WORLD_W, 10, 55);
  const standoffMeters = clamp(zoneMeters * 0.15, 0.5, 25);
  // tower well inside the road side of the alignment budget (physics: lower tower = more lead)
  const towerMax = zoneMeters - standoffMeters - 3.4;
  const towerMeters = clamp(towerMax * 0.7, 5, 59);
  const speakers = zoneMeters > 40 ? 5 : zoneMeters > 25 ? 3 : 2;
  const where = horizontalRoad ? 'road at the bottom of the photo' : 'road on the side of the photo';
  return {
    towerMeters: Math.round(towerMeters * 10) / 10,
    zoneMeters: Math.round(zoneMeters * 10) / 10,
    standoffMeters: Math.round(standoffMeters * 10) / 10,
    speakers,
    note: `from the photo (${where}): zone ≈ ${zoneMeters.toFixed(0)} m out, ${speakers} array nodes — confirm before applying`,
    fallback: false,
  };
}

const gapMeters = (b: Box, road: Box, fw: number, fh: number): number => {
  const horizontalRoad = (road.x2 - road.x1) >= (road.y2 - road.y1);
  return horizontalRoad ? ((b.y1 - road.y2) / fh) * 60 : ((b.x1 - road.x2) / fw) * 60;
};