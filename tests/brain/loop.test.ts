// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { runAgentTurn, proposeTurn, applyDecision, type AgentTurnContext } from '../../src/brain/loop.js';
import { createAgentConsole } from '../../src/ui/agentConsole.js';
import type { AgentDecision, AgentState, Brain } from '../../src/brain/brain.js';
import { CONFIG } from '../../src/core/rng.js';
import { quietBandMeters } from '../../src/ui/fieldViz.js';

const GEO = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };

function fakeBrain(decision: AgentDecision): Brain {
  return { propose: async (_s: AgentState) => decision };
}


const CTX: AgentTurnContext = { goal: 'depth', memory: [] };

function host(): HTMLElement {
  return document.createElement('div');
}

describe('propose → review → apply flow', () => {
  test('area goal + remembered precedents ride through to the state packet, band matches node count', async () => {
    const con = createAgentConsole(host());
    const prop = await proposeTurn(fakeBrain({ kind: 'unavailable', reason: 'x' }), { ...GEO, speakers: 3 },
      { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 },
      con, { goal: 'area', memory: ['goal: area · synthetic · tower 20m zone 30m standoff 5m 5 nodes · 20.2 dB · band 12.0 m'] });
    expect(prop.packet.goal).toBe('area');
    expect(prop.packet.memory).toHaveLength(1);
    expect(prop.packet.bandMeters).toBeGreaterThan(quietBandMeters(GEO, 100)); // 3 nodes → wider than 1
  });

  test('proposeTurn returns the decision WITHOUT changing anything', async () => {
    const brain = fakeBrain({
      kind: 'apply',
      geometry: { ...GEO, speakers: 3, standoffMeters: 3 },
      mu: 0.08,
      note: 'cut the standoff for a tighter field',
    });
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 };
    const prop = await proposeTurn(brain, GEO, result, con, CTX);
    expect(prop.decision.kind).toBe('apply');
    expect(prop.packet.geometry).toEqual(GEO); // untouched: nothing applied yet
    expect(prop.packet.goal).toBe('depth');
    expect(prop.packet.bandMeters).toBeGreaterThan(0);
    expect(prop.packet.memory).toEqual([]);
  });

  test('applyDecision applies ONLY the selected params, one console row each', async () => {
    const decision = {
      kind: 'apply' as const,
      geometry: { ...GEO, speakers: 3, standoffMeters: 3, towerMeters: 22 },
      mu: 0.08,
      note: 'n',
    };
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 };
    const next = await applyDecision(GEO, result, decision, con, { only: ['speakers', 'standoffMeters'] });
    expect(next.geometry.speakers).toBe(3); // selected → applied
    expect(next.geometry.standoffMeters).toBe(3);
    expect(next.geometry.towerMeters).toBe(20); // NOT selected → stays
    expect(next.reductionDb).toBeGreaterThan(0); // re-measured
    // trail order (newest = row 0): [0] the re-measure, [1] rows in PARAMS order (speakers, then standoff)
    expect(con.rowText(0)).toContain('after');
    expect(con.rowText(2)).toContain('standoff 5 → 3 m');
    expect(con.rowText(1)).toContain('nodes 1 → 3');
  });

  test('applyDecision with no selection = apply all (old behavior)', async () => {
    const decision = {
      kind: 'apply' as const,
      geometry: { ...GEO, speakers: 3, standoffMeters: 3, towerMeters: 22 },
      mu: 0.08,
      note: 'n',
    };
    const con = createAgentConsole(host());
    const next = await applyDecision(
      GEO,
      { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 },
      decision,
      con,
    );
    expect(next.geometry).toEqual({ ...GEO, speakers: 3, standoffMeters: 3, towerMeters: 22 });
  });

  test('applyDecision threads the active sourceSignal into the re-measure (no silent source swap)', async () => {
    // distinctive 50 Hz source, amplitude 0.9 — very different from the synthetic bed
    const sig = new Float32Array(720000);
    for (let i = 0; i < sig.length; i++) sig[i] = Math.sin((2 * Math.PI * 50 * i) / 16000) * 0.9;
    const decision = {
      kind: 'apply' as const,
      geometry: { ...GEO, speakers: 3 },
      mu: 0.08,
      note: 'n',
    };
    const con = createAgentConsole(host());
    const next = await applyDecision(
      GEO,
      { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 },
      decision,
      con,
      { sourceSignal: sig },
    );
    // the open-loop zone noise must be the PROVIDED signal propagated to 30 m (gain 0.25)
    const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);
    expect(next.reductionDb).toBeGreaterThan(0);
    expect(rms(next.openLoop.subarray(16000)) / rms(sig.subarray(0, 176000))).toBeCloseTo(0.25, 1);
  });

  test('unavailable decision → proposeTurn surfaces the reason; applyDecision rejects the call cleanly', async () => {
    const brain = fakeBrain({ kind: 'unavailable', reason: 'budget' });
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 };
    const prop = await proposeTurn(brain, GEO, result, con, CTX);
    expect(prop.decision).toEqual({ kind: 'unavailable', reason: 'budget' });
    expect(con.rowText(0)).toContain('budget');
  });
});

describe('applyDecision knob ownership (audit regressions)', () => {
  test('the model template never overrides the traffic level (user knob)', async () => {
    const con = createAgentConsole(host());
    const userGeo = { ...GEO, trafficLevel: 1.4 };
    const decision = { kind: 'apply' as const, geometry: { ...GEO, trafficLevel: 1, towerMeters: 21 }, mu: 0.08, note: 'n' };
    const next = await applyDecision(userGeo, { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 10 }, decision, con);
    expect(next.geometry.trafficLevel).toBe(1.4); // stays the user's Heavy
    expect(next.geometry.towerMeters).toBe(21); // the agent's real knob applied
  });
});

describe('runAgentTurn (accept-all composite, unchanged behavior)', () => {
  test('state packet carries the live truth (reduction, lead, geometry, zoneDepth)', async () => {
    let seen: AgentState | null = null;
    const brain: Brain = { propose: async (s) => (seen = s, { kind: 'unavailable', reason: 'noop' }) };
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(10), closedLoop: new Float32Array(10), reductionDb: 18 };
    await runAgentTurn(brain, GEO, result, con, CTX);
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
    const next = await runAgentTurn(brain, GEO, result, con, CTX);
    expect(next.geometry.speakers).toBe(3);
    expect(next.reductionDb).toBeGreaterThan(0); // rerun happened
    const proposalRow = con.rowText(1)!; // newest-first: row 0 = the "after" measurement, row 1 = the agent's proposal
    expect(proposalRow).toContain('wider honest band');
    expect(proposalRow).toContain('10.0 dB');
  });

  test('unavailable decision → geometry unchanged, console shows the honest stand-down', async () => {
    const brain = fakeBrain({ kind: 'unavailable', reason: 'model spent its entire token budget reasoning — no decision content' });
    const con = createAgentConsole(host());
    const result = { openLoop: new Float32Array(10), closedLoop: new Float32Array(10), reductionDb: 10 };
    const next = await runAgentTurn(brain, GEO, result, con, CTX);
    expect(next.geometry).toEqual(GEO);
    expect(con.rowText(0)!).toContain('budget');
  });
});