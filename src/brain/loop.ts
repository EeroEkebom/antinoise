import { CONFIG } from '../core/rng.js';
import { runScenario, type ScenarioResult } from '../core/scenario.js';
import { leadMs, geometryToScenarioConfig, WORLD_HEIGHT_M, type Geometry } from '../ui/geometry.js';
import { zoneDepthDb } from '../ui/fieldViz.js';
import type { AgentState, Brain } from './brain.js';
import type { AgentConsole } from '../ui/agentConsole.js';

export type AgentTurnResult = ScenarioResult & { geometry: Geometry };

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
  const cfg = geometryToScenarioConfig(nextGeo, { seed: 42, sampleCount: 160000 });
  if (decision.mu !== undefined) cfg.mu = Math.max(0.001, Math.min(0.3, decision.mu));
  const next = runScenario(cfg);
  con.log({
    state: `after: ${next.reductionDb.toFixed(1)} dB · lead ${leadMs(nextGeo).toFixed(0)} ms`,
    decision: 'measured',
    applied: `tower ${nextGeo.towerMeters.toFixed(0)} m · zone ${nextGeo.zoneMeters.toFixed(0)} m · ${nextGeo.speakers} nodes`,
  });
  con.setStatus('idle', false);
  void CONFIG;
  return { ...next, geometry: nextGeo };
}