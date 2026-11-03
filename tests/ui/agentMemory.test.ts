import { describe, expect, test } from 'vitest';
import { createAgentMemory } from '../../src/ui/agentMemory.js';
import type { AgentLesson } from '../../src/ui/agentMemory.js';
import type { Geometry } from '../../src/ui/geometry.js';

const G: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };

const lesson = (over: Partial<AgentLesson> = {}): AgentLesson => ({
  goal: 'depth',
  source: 'synthetic',
  geometry: { ...G },
  measuredDb: 20.2,
  bandMeters: 12,
  note: 'spread the array',
  ...over,
});

// tiny in-memory storage substitute — same shape as the guarded localStorage
function fakeStorage(): { get: (k: string) => string | null; set: (k: string, v: string) => void; remove: (k: string) => void } {
  const m = new Map<string, string>();
  return {
    get: (k) => m.get(k) ?? null,
    set: (k, v) => void m.set(k, v),
    remove: (k) => void m.delete(k),
  };
}

describe('createAgentMemory', () => {
  test('empty store → no precedents, count 0', () => {
    const mem = createAgentMemory(fakeStorage());
    expect(mem.count()).toBe(0);
    expect(mem.precedents()).toEqual([]);
  });

  test('record + persists across instances (localStorage round-trip)', () => {
    const store = fakeStorage();
    const mem = createAgentMemory(store);
    mem.record(lesson());
    const again = createAgentMemory(store);
    expect(again.count()).toBe(1);
    expect(again.precedents()[0]).toContain('20.2 dB');
  });

  test('record survives a broken storage (memory lives only this session)', () => {
    const broken = { get: () => null, set: () => { throw new Error('blocked'); }, remove: () => undefined };
    const mem = createAgentMemory(broken);
    expect(() => mem.record(lesson())).not.toThrow();
    expect(mem.count()).toBe(1); // in-session value still there
  });

  test('cap: keeps the newest 12, drops the oldest', () => {
    const mem = createAgentMemory(fakeStorage());
    for (let i = 0; i < 14; i++) mem.record(lesson({ measuredDb: i, note: `turn ${i}` }));
    expect(mem.count()).toBe(12);
    expect(mem.precedents()[0]).toContain('turn 2'); // oldest two dropped
    expect(mem.precedents().at(-1)).toContain('turn 13'); // newest kept
  });

  test('precedent lines carry the facts the model should reuse: goal · source · geometry · both metrics', () => {
    const mem = createAgentMemory(fakeStorage());
    mem.record(lesson({ goal: 'area', source: 'traffic-city-highway', mu: 0.12, bandMeters: 31.4 }));
    const line = mem.precedents()[0];
    expect(line).toContain('goal: area');
    expect(line).toContain('real: traffic-city-highway');
    expect(line).toContain('tower 20');
    expect(line).toContain('band 31.4 m');
    expect(line).toContain('20.2 dB');
    expect(line).toContain('mu 0.12');
  });

  test('clear() wipes everything (explicit clear button)', () => {
    const store = fakeStorage();
    const mem = createAgentMemory(store);
    mem.record(lesson());
    mem.clear();
    expect(mem.count()).toBe(0);
    expect(createAgentMemory(store).count()).toBe(0);
  });
});