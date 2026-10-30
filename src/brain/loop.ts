import { runScenario, type ScenarioResult } from '../core/scenario.js';
import { leadMs, geometryToScenarioConfig, WORLD_HEIGHT_M, type Geometry } from '../ui/geometry.js';
import { zoneDepthDb } from '../ui/fieldViz.js';
import type { AgentState, Brain } from './brain.js';
import type { AgentConsole } from '../ui/agentConsole.js';

export type AgentTurnResult = ScenarioResult & { geometry: Geometry };

const DEFAULT_SPACING = 4;
let lastMu: number | undefined = undefined;

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

/** One agent turn: propose → (validate on the brain side) → apply + rerun → console trail. */
export async function runAgentTurn(
  brain: Brain,
  geo: Geometry,
  result: ScenarioResult,
  con: AgentConsole,
): Promise<AgentTurnResult> {
  const decision = await brain.propose(packet(geo, result));
  con.setStatus('acting', true);
  if (decision.kind === 'unavailable') {
    con.log({ state: `${result.reductionDb.toFixed(1)} dB · lead ${leadMs(geo).toFixed(0)} ms`, decision: 'stands down', applied: `unavailable: ${decision.reason}` });
    con.setStatus('idle', false);
    return { ...result, geometry: geo };
  }
  con.log({
    state: `${result.reductionDb.toFixed(1)} dB · lead ${leadMs(geo).toFixed(0)} ms`,
    decision: decision.note || 'proposed a change',
    applied: 'applied — rerunning the field',
  });
  const nextGeo = decision.geometry;
  // human-readable parameter diff for the console's "applied" cell
  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const diffs: string[] = [];
  if (nextGeo.towerMeters !== geo.towerMeters) diffs.push(`tower ${fmt(geo.towerMeters)} → ${fmt(nextGeo.towerMeters)} m`);
  if (nextGeo.zoneMeters !== geo.zoneMeters) diffs.push(`zone ${fmt(geo.zoneMeters)} → ${fmt(nextGeo.zoneMeters)} m`);
  if (nextGeo.standoffMeters !== geo.standoffMeters) diffs.push(`standoff ${fmt(geo.standoffMeters)} → ${fmt(nextGeo.standoffMeters)} m`);
  if (nextGeo.speakers !== geo.speakers) diffs.push(`nodes ${geo.speakers} → ${nextGeo.speakers}`);
  if ((nextGeo as { spacingMeters?: number }).spacingMeters !== (geo as { spacingMeters?: number }).spacingMeters)
    diffs.push(`spacing ${fmt(geo.spacingMeters ?? DEFAULT_SPACING)} → ${fmt(nextGeo.spacingMeters ?? DEFAULT_SPACING)} m`);
  if (decision.mu !== undefined && decision.mu !== lastMu) diffs.push(`μ ${lastMu == undefined ? '—' : fmt(lastMu)} → ${fmt(decision.mu)}`);
  lastMu = decision.mu;
  const cfg = geometryToScenarioConfig(nextGeo, { seed: 42, sampleCount: 160000 });
  if (decision.mu !== undefined) cfg.mu = Math.max(0.001, Math.min(0.3, decision.mu));
  const next = runScenario(cfg);
  con.log({
    state: `after: ${next.reductionDb.toFixed(1)} dB · lead ${leadMs(nextGeo).toFixed(0)} ms`,
    decision: 'measured after the change',
    applied: diffs.length > 0 ? diffs.join(' · ') : 'no parameter change',
  });
  con.setStatus('idle', false);
  return { ...next, geometry: nextGeo };
}