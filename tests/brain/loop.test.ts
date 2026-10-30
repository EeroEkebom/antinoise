// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { runAgentTurn } from '../../src/brain/loop.js';
import { createAgentConsole } from '../../src/ui/agentConsole.js';
import type { AgentDecision, AgentState, Brain } from '../../src/brain/brain.js';
import { CONFIG } from '../../src/core/rng.js';

const GEO = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };

function fakeBrain(decision: AgentDecision): Brain {
  return { propose: async (_s: AgentState) => decision };
}

function host(): HTMLElement {
  return document.createElement('div');
}

describe('runAgentTurn', () => {
  test('state packet carries the live truth (reduction, lead, geometry, zoneDepth)', async () => {
    let seen: AgentState | null = null;
    const brain: Brain = { propose: async (s) => (seen = s, { kind: 'unavailable', reason: 'noop' }) };
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(10), closedLoop: new Float32Array(10), reductionDb: 18 };
    await runAgentTurn(brain, GEO, result, con);
    expect(seen!.reductionDb).toBe(18);
    expect(seen!.leadMs).toBeGreaterThan(0);
    expect(seen!.geometry).toEqual(GEO);
    expect(seen!.zoneDepth.length).toBeGreaterThan(0);
  });

  test('apply decision → geometry changed, console row logged, new result returned', async () => {
    const brain = fakeBrain({
      kind: 'apply',
      geometry: { ...GEO, speakers: 3 },
      mu: 0.08,
      note: 'spread the array for a wider honest band',
    });
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(10), closedLoop: new Float32Array(10), reductionDb: 10 };
    const next = await runAgentTurn(brain, GEO, result, con);
    expect(next.geometry.speakers).toBe(3);
    expect(next.reductionDb).toBeGreaterThan(0); // rerun happened
    const row = con.rowText(1)!; // newest-first: row 0 = the "after" measurement, row 1 = the agent's proposal
    expect(row).toContain('wider honest band');
    expect(row).toContain('10.0 dB');
  });

  test('unavailable decision → geometry unchanged, console shows the honest stand-down', async () => {
    const brain = fakeBrain({ kind: 'unavailable', reason: 'model spent its entire token budget reasoning — no decision content' });
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(10), closedLoop: new Float32Array(10), reductionDb: 10 };
    const next = await runAgentTurn(brain, GEO, result, con);
    expect(next.geometry).toEqual(GEO);
    expect(con.rowText(0)!).toContain('budget');
  });
});