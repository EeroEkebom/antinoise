import { describe, expect, test } from 'vitest';
import { createSessionBest, setupLabel } from '../../src/ui/sessionBest.js';

const A = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };
const B = { towerMeters: 10, zoneMeters: 35, standoffMeters: 3, y: 0.5, trafficLevel: 1, speakers: 5 };

describe('createSessionBest', () => {
  test('empty until the first result considered', () => {
    const b = createSessionBest();
    expect(b.current()).toBe(null);
    b.consider(10, A);
    expect(b.current()?.db).toBe(10);
  });

  test('improvements replace; worse setups keep the best', () => {
    const b = createSessionBest();
    b.consider(10, A);
    b.consider(21, B);
    expect(b.current()?.db).toBe(21);
    expect(b.current()?.geometry).toEqual(B);
    b.consider(12, A);
    expect(b.current()?.db).toBe(21); // best survives the worse attempt
  });

  test('restore returns the winning geometry (a copy — safe to mutate through reruns)', () => {
    const b = createSessionBest();
    b.consider(21, B);
    const g = b.restore()!;
    g.towerMeters = 99;
    expect(b.current()?.geometry.towerMeters).toBe(10);
  });

  test('label formats the standing best', () => {
    const b = createSessionBest();
    b.consider(20.9, B);
    expect(b.label()).toContain('20.9 dB');
    expect(b.label()).toContain('35');
  });
});

describe('setupLabel', () => {
  test('compact setup text', () => {
    expect(setupLabel(A)).toBe('tower 20 m · zone 30 m · array 5.0 m · 1 nodes');
  });
});