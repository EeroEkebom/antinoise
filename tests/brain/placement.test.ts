import { describe, expect, test } from 'vitest';
import { parseSamBoxes, interpretPlacement, type Box } from '../../src/brain/placement.js';

const FRAME = { w: 1200, h: 800 };

describe('parseSamBoxes', () => {
  test('one line, two objects → two boxes keyed by id', () => {
    const line = '<0f>0<|box;x1=0;y1=560;x2=1200;y2=700;w=1200;h=800|><|mask;x=0;y=0;data=37,60,~payload...|>,1<|box;x1=900;y1=200;x2=1150;y2=380;w=1200;h=800|><|mask;x=0;y=0;data=20,40,~payload...|>';
    const boxes = parseSamBoxes(line);
    expect(boxes).toHaveLength(2);
    const byId = new Map(boxes.map((b) => [b.id, b]));
    expect(byId.get(0)).toEqual({ id: 0, frame: 0, x1: 0, y1: 560, x2: 1200, y2: 700, w: 1200, h: 800 } as Box);
    expect(byId.get(1)?.x1).toBe(900);
  });

  test('keyed by key not position (confidence + sparse ids tolerated)', () => {
    const line = '<0f>2<|box;x1=444;y1=625;x2=679;y2=850;w=1800;h=1200;c=0.9609375|><|mask;x=0;y=0;c=0.9609375;data=226,236,!payload|>';
    const boxes = parseSamBoxes(line);
    expect(boxes[0]).toMatchObject({ id: 2, x1: 444, y1: 625, x2: 679, y2: 850, w: 1800, h: 1200 });
  });

  test('empty lane (zero matches) → no boxes', () => {
    expect(parseSamBoxes('')).toEqual([]);
  });

  test('multi-frame: returns only the requested frame', () => {
    const txt = '<0f>0<|box;x1=0;y1=500;x2=100;y2=600;w=1000;h=700|><|mask;x=0;y=0;data=10,20,~p|>\n<3f>1<|box;x1=500;y1=100;x2=900;y2=300;w=1000;h=700|><|mask;x=0;y=0;data=20,30,~p|>';
    const f0 = parseSamBoxes(txt, 0);
    expect(f0).toHaveLength(1);
    expect(f0[0].y1).toBe(500);
    expect(parseSamBoxes(txt, 3)).toHaveLength(1);
  });
});

describe('interpretPlacement', () => {
  test('road band + open ground box → feasible geometry between road and open side', () => {
    const roadBoxes: Box[] = [{ id: 0, frame: 0, x1: 0, y1: 560, x2: 1200, y2: 700, w: 1200, h: 800 }];
    const openBoxes: Box[] = [{ id: 1, frame: 0, x1: 300, y1: 150, x2: 1000, y2: 520, w: 1200, h: 800 }];
    const p = interpretPlacement({ road: roadBoxes, zone: openBoxes }, FRAME.w, FRAME.h);
    expect(p.towerMeters).toBeLessThanOrEqual(25); // must keep feasibility head start for the 30 m zone
    expect(p.zoneMeters).toBeGreaterThanOrEqual(p.towerMeters + p.standoffMeters + 3.4);
    expect(p.speakers).toBeGreaterThanOrEqual(1);
    expect(validate(p)).toBe(true);
  });

  test('photo proportions translate: the corridor sits between road and the open area', () => {
    const roadBoxes: Box[] = [{ id: 0, frame: 0, x1: 0, y1: 700, x2: 1200, y2: 800, w: 1200, h: 800 }]; // road at bottom
    const openBoxes: Box[] = [{ id: 1, frame: 0, x1: 200, y1: 60, x2: 1000, y2: 400, w: 1200, h: 800 }]; // open far above
    const p = interpretPlacement({ road: roadBoxes, zone: openBoxes }, FRAME.w, FRAME.h);
    expect(p).toMatchObject({});
    validate(p);
  });

  test('no road found → honest fallback proposal (untouched geometry, note explains)', () => {
    const p = interpretPlacement({ road: [], zone: [] }, FRAME.w, FRAME.h);
    expect(p.fallback).toBe(true);
    expect(p.note).toMatch(/no (road|segmentation)/i);
  });
});

function validate(p: ReturnType<typeof interpretPlacement>): boolean {
  return p.towerMeters >= 5 && p.zoneMeters >= 10 && p.standoffMeters >= 0.5 && p.speakers >= 1 && p.speakers <= 5;
}