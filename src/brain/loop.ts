import { runScenario, type ScenarioResult } from '../core/scenario.js';
import { leadMs, geometryToScenarioConfig, WORLD_HEIGHT_M, type Geometry } from '../ui/geometry.js';
import { zoneDepthDb } from '../ui/fieldViz.js';
import type { AgentDecision, AgentState, Brain } from './brain.js';
import type { AgentConsole } from '../ui/agentConsole.js';

export type AgentTurnResult = ScenarioResult & { geometry: Geometry };

const DEFAULT_SPACING = 4;

/** The live-truth state packet — sim numbers only, never personal data. */
export function packet(geo: Geometry, result: ScenarioResult): AgentState {
  return {
    reductionDb: result.reductionDb,
    leadMs: leadMs(geo),
    geometry: geo,
    zoneDepth: [63, 100, 250, 630].map((f) => ({
      freqHz: f,
      depthDb: zoneDepthDb(geo, WORLD_HEIGHT_M / 2, f),
    })),
  };
}

/** A proposed turn the user can review before anything changes. */
export type Proposal = { packet: AgentState; decision: AgentDecision };

/** Propose only — nothing changes. Console logs the stand-down reason if the brain can't propose. */
export async function proposeTurn(
  brain: Brain,
  geo: Geometry,
  result: ScenarioResult,
  con: AgentConsole,
): Promise<Proposal> {
  const pkt = packet(geo, result);
  const decision = await brain.propose(pkt);
  con.setStatus('thinking', true);
  if (decision.kind === 'unavailable') {
    con.setStatus('idle', false);
    con.log({
      state: `${result.reductionDb.toFixed(1)} dB · lead ${leadMs(geo).toFixed(0)} ms`,
      decision: 'no proposal available',
      applied: `it explained: ${decision.reason}`,
    });
  }
  return { packet: pkt, decision };
}

const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const fmtU = (v: number | undefined): string => fmt(v ?? DEFAULT_SPACING);

const PARAMS = ['towerMeters', 'zoneMeters', 'standoffMeters', 'speakers', 'spacingMeters'] as const;

/** Apply a reviewed decision — all changes, or only the user-selected params (one console row each). */
export async function applyDecision(
  geo: Geometry,
  result: ScenarioResult,
  decision: Extract<AgentDecision, { kind: 'apply' }>,
  con: AgentConsole,
  opts: { only?: (typeof PARAMS)[number][] } = {},
): Promise<AgentTurnResult> {
  con.setStatus('applying', true);
  const nextGeo: Geometry = { ...geo, ...decision.geometry };
  if (opts.only?.length) {
    for (const k of PARAMS) {
      if (!opts.only.includes(k) || nextGeo[k] === geo[k]) {
        (nextGeo as unknown as Record<string, unknown>)[k] = geo[k]; // keep untouched params
        continue;
      }
      const label = { towerMeters: 'tower', zoneMeters: 'zone', standoffMeters: 'standoff', speakers: 'nodes', spacingMeters: 'spacing' }[k];
      con.log({
        state: `${result.reductionDb.toFixed(1)} dB`,
        decision: (decision.note || 'proposed a change').slice(0, 80),
        applied: `${label} ${fmtU(geo[k])} → ${fmtU(nextGeo[k])} m`,
      });
    }
  }
  const cfg = geometryToScenarioConfig(nextGeo, { seed: 42, sampleCount: 160000 });
  if (decision.mu !== undefined) cfg.mu = Math.max(0.001, Math.min(0.3, decision.mu));
  const next = runScenario(cfg);
  if (opts.only?.length) {
    con.log({
      state: `after: ${next.reductionDb.toFixed(1)} dB · lead ${leadMs(nextGeo).toFixed(0)} ms`,
      decision: 're-measured your accepted changes',
      applied: decision.mu !== undefined ? `μ → ${fmt(decision.mu)}` : 'field updated',
    });
  } else {
    // apply-all = one combined row (the previous behavior)
    const diffs: string[] = [];
    if (nextGeo.towerMeters !== geo.towerMeters) diffs.push(`tower ${fmt(geo.towerMeters)} → ${fmt(nextGeo.towerMeters)} m`);
    if (nextGeo.zoneMeters !== geo.zoneMeters) diffs.push(`zone ${fmt(geo.zoneMeters)} → ${fmt(nextGeo.zoneMeters)} m`);
    if (nextGeo.standoffMeters !== geo.standoffMeters) diffs.push(`standoff ${fmt(geo.standoffMeters)} → ${fmt(nextGeo.standoffMeters)} m`);
    if (nextGeo.speakers !== geo.speakers) diffs.push(`nodes ${geo.speakers} → ${nextGeo.speakers}`);
    if ((nextGeo.spacingMeters ?? DEFAULT_SPACING) !== (geo.spacingMeters ?? DEFAULT_SPACING))
      diffs.push(`spacing ${fmtU(geo.spacingMeters)} → ${fmtU(nextGeo.spacingMeters)} m`);
    con.log({
      state: `after: ${next.reductionDb.toFixed(1)} dB · lead ${leadMs(nextGeo).toFixed(0)} ms`,
      decision: 'measured after the change',
      applied: diffs.length > 0 ? diffs.join(' · ') : 'no parameter change',
    });
  }
  con.setStatus('idle', false);
  return { ...next, geometry: nextGeo };
}

/** One agent turn: propose → validated → apply all + rerun → console trail (the accept-all composite). */
export async function runAgentTurn(
  brain: Brain,
  geo: Geometry,
  result: ScenarioResult,
  con: AgentConsole,
): Promise<AgentTurnResult> {
  const { decision } = await proposeTurn(brain, geo, result, con);
  if (decision.kind === 'unavailable') {
    return { ...result, geometry: geo };
  }
  con.log({
    state: `${result.reductionDb.toFixed(1)} dB · lead ${leadMs(geo).toFixed(0)} ms`,
    decision: decision.note || 'proposed a change',
    applied: 'applied — rerunning the field',
  });
  return applyDecision(geo, result, decision, con);
}