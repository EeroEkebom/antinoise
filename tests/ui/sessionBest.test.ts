import { describe, expect, test } from 'vitest';
import { createSessionBest, setupLabel } from '../../src/ui/sessionBest.js';

const A = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };
const B = { towerMeters: 10, zoneMeters: 35, standoffMeters: 3, y: 0.5, trafficLevel: 1, speakers: 5 };

describe('createSessionBest (per traffic source)', () => {
  test('empty until the first result considered', () => {
    const b = createSessionBest();
    expect(b.current('synthetic')).toBe(null);
    b.consider(10, A, 'synthetic');
    expect(b.current('synthetic')?.db).toBe(10);
  });

  test('improvements replace; worse setups keep the best', () => {
    const b = createSessionBest();
    b.consider(10, A, 'synthetic');
    b.consider(21, B, 'synthetic');
    expect(b.current('synthetic')?.db).toBe(21);
    expect(b.current('synthetic')?.geometry).toEqual(B);
    b.consider(12, A, 'synthetic');
    expect(b.current('synthetic')?.db).toBe(21); // best survives the worse attempt
  });

  test('each source keeps its own best — switching sources gives its fresh/own number', () => {
    const b = createSessionBest();
    b.consider(22, B, 'synthetic');
    b.consider(15, A, 'traffic-city-highway');
    expect(b.current('synthetic')?.db).toBe(22);
    expect(b.current('traffic-city-highway')?.db).toBe(15);
    expect(b.current('traffic-motorway-m6')).toBe(null); // untouched source: no result yet
    // returning to a source does not leak the other source's higher number
    b.consider(17, A, 'traffic-city-highway');
    expect(b.current('traffic-city-highway')?.db).toBe(17);
    expect(b.current('synthetic')?.db).toBe(22);
  });

  test('same source, different key: a real file never reads the synthetic best', () => {
    const b = createSessionBest();
    b.consider(30, B, 'synthetic');
    expect(b.current('traffic-us-hwy64-wet')?.db).not.toBe(30);
    expect(b.current('traffic-us-hwy64-wet')).toBe(null);
  });

  test('restore returns the winning geometry for the asked source (a copy — safe to mutate through reruns)', () => {
    const b = createSessionBest();
    b.consider(21, B, 'synthetic');
    b.consider(15, A, 'traffic-city-highway');
    const g = b.restore('traffic-city-highway')!;
    g.towerMeters = 99;
    expect(b.current('traffic-city-highway')?.geometry.towerMeters).toBe(20);
    expect(b.restore('synthetic')!.towerMeters).toBe(10); // other sources untouched
  });

  test('reset clears every source (full-scratch reset button)', () => {
    const b = createSessionBest();
    b.consider(21, B, 'synthetic');
    b.consider(15, A, 'traffic-city-highway');
    b.reset();
    expect(b.current('synthetic')).toBe(null);
    expect(b.current('traffic-city-highway')).toBe(null);
  });

  test('label formats the standing best for the asked source', () => {
    const b = createSessionBest();
    b.consider(20.9, B, 'synthetic');
    expect(b.label('synthetic')).toContain('20.9 dB');
    expect(b.label('synthetic')).toContain('35');
    expect(b.label('traffic-city-highway')).toBe('no result yet');
  });
});

describe('setupLabel', () => {
  test('compact setup text', () => {
    expect(setupLabel(A)).toBe('tower 20 m · zone 30 m · array 5.0 m · 1 nodes');
  });
});