/** Manual soak gate: N live agent turns over varied setups, one shared memory —
 * does the agent improve over time with its accumulated precedents? Real Baseten calls.
 * Usage: npx tsx src/cli/agent-soak.ts [runs=10] [goal=depth|area] (uses BASETEN_API_KEY or the key file).
 * Each run: propose → validate → apply → re-measure → file lesson; worse outcomes get reverted
 * (the on-screen one-click revert) but still filed as a lesson with its measured truth. */
import { createBasetenRoute } from '../brain/baseten.js';
import { applyDecision, packet } from '../brain/loop.js';
import type { AgentGoal } from '../brain/brain.js';
import type { AgentConsole } from '../ui/agentConsole.js';
import { runScenario, type ScenarioResult } from '../core/scenario.js';
import { validateGeometry, geometryToScenarioConfig, type Geometry } from '../ui/geometry.js';
import { quietBandMeters } from '../ui/fieldViz.js';
import { createAgentMemory } from '../ui/agentMemory.js';
import { extractKey } from '../core/keyfile.js';
import { resolveLocalPaths } from '../core/paths.js';
import { readFileSync } from 'node:fs';

const RUNS = Number(process.argv[2] ?? 10);
const goal: AgentGoal = process.argv[3] === 'area' ? 'area' : 'depth';
const SYNTH_SEED = 42; // same seed as the app's synthetic source

// varied-but-realistic setups: every one physically feasible (zone > tower + standoff + 3.4 m)
const SETUPS: { geom: Geometry; label: string }[] = [
  { geom: { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 }, label: 'defaults' },
  { geom: { towerMeters: 15, zoneMeters: 35, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 2 }, label: 'narrow tower' },
  { geom: { towerMeters: 25, zoneMeters: 45, standoffMeters: 6, y: 0.5, trafficLevel: 1, speakers: 1 }, label: 'long fiber' },
  { geom: { towerMeters: 12, zoneMeters: 40, standoffMeters: 6, y: 0.5, trafficLevel: 1.4, speakers: 3 }, label: 'heavy traffic' },
  { geom: { towerMeters: 30, zoneMeters: 50, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 2 }, label: 'far zone' },
  { geom: { towerMeters: 18, zoneMeters: 40, standoffMeters: 5, y: 0.5, trafficLevel: 0.6, speakers: 1 }, label: 'light traffic' },
  { geom: { towerMeters: 22, zoneMeters: 45, standoffMeters: 4.5, y: 0.5, trafficLevel: 1, speakers: 4 }, label: '4-node array' },
  { geom: { towerMeters: 10, zoneMeters: 38, standoffMeters: 5.5, y: 0.5, trafficLevel: 1.4, speakers: 2 }, label: 'close sensor' },
  { geom: { towerMeters: 28, zoneMeters: 48, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 3 }, label: 'motorway-like' },
  { geom: { towerMeters: 16, zoneMeters: 44, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 5 }, label: 'full array' },
];

function readKey(): string {
  const env = process.env.BASETEN_API_KEY;
  if (env) return env;
  return extractKey(readFileSync(resolveLocalPaths().basetenKeyRtf, 'utf8'), 'b10_');
}

// silent console stub — the soak prints its own table
const con: AgentConsole = {
  log: () => undefined,
  setStatus: () => undefined,
  startThinking: () => undefined,
  stopThinking: () => undefined,
  statusText: () => '',
  rowText: () => null,
  rows: () => [],
} as unknown as AgentConsole;

const STUB_RESULT: ScenarioResult = { openLoop: new Float32Array(4), closedLoop: new Float32Array(4), reductionDb: 0 };

/** Honest measurement of a geometry: fresh sim run (with the app's synthetic seed) + the shared band metric. */
function measure(g: Geometry): { db: number; band: number } {
  const r = runScenario(geometryToScenarioConfig(g, { seed: SYNTH_SEED, sampleCount: 160000 }));
  return { db: r.reductionDb, band: quietBandMeters(g, 100) };
}

void (async () => {
  const brain = createBasetenRoute(readKey());
  const ramStore = { get: () => null, set: () => undefined, remove: () => undefined }; // no persistence between soak invocations
  const memory = createAgentMemory(ramStore as never);

  const rows: string[] = [];
  let firstKept: { db: number; band: number } | null = null;
  let lastKept: { db: number; band: number } | null = null;
  let kept = 0;
  let reverted = 0;
  let failed = 0;

  for (let i = 0; i < Math.min(RUNS, SETUPS.length); i++) {
    const { geom, label } = SETUPS[i];
    const v = validateGeometry(geom);
    if (!v.ok) {
      rows.push(`${i + 1}. ${label} — SKIP (setup itself infeasible: ${v.message})`);
      continue;
    }
    const pre = measure(geom);
    const start = Date.now();
    let decision;
    try {
      decision = await brain.propose(packet(geom, { ...STUB_RESULT, reductionDb: pre.db }, { goal, memory: memory.precedents() }));
    } catch (e) {
      decision = { kind: 'unavailable' as const, reason: String(e) };
    }
    const tookS = ((Date.now() - start) / 1000).toFixed(1);

    if (decision.kind === 'unavailable') {
      failed++;
      rows.push(`${i + 1}. ${label} — UNAVAILABLE (${decision.reason.slice(0, 90)})`);
      continue;
    }

    // apply + re-measure through the SAME loop code the app uses (the stub console swallows its rows)
    const next = await applyDecision(geom, { ...STUB_RESULT, reductionDb: pre.db }, decision, con, { bandFreqHz: 100 });
    const measured = measure(next.geometry);
    const worse = goal === 'area' ? measured.band < pre.band - 0.1 : measured.db < pre.db - 0.1;
    if (worse) reverted++; else { kept++; firstKept ??= measured; lastKept = measured; }

    // the truth goes into memory even when reverted — that is what the app records too
    memory.record({
      goal,
      source: 'synthetic',
      geometry: worse ? geom : next.geometry,
      mu: decision.mu,
      measuredDb: measured.db,
      bandMeters: measured.band,
      note: decision.note,
    });

    const applied = worse ? 'REVERTED' : 'kept';
    rows.push(`${i + 1}. ${label} — ${pre.db.toFixed(1)} → ${measured.db.toFixed(1)} dB (${applied}) · band ${pre.band.toFixed(1)} → ${measured.band.toFixed(1)} m · ${tookS}s · mem ${memory.count()} · "${decision.note.slice(0, 70)}"`);
  }

  console.log(rows.join('\n'));
  console.log(`\nSUMMARY goal=${goal} · runs ${Math.min(RUNS, SETUPS.length)} · kept ${kept} · reverted ${reverted} · unavailable ${failed}`);
  if (firstKept && lastKept) {
    console.log(`run #1 kept: ${firstKept.db.toFixed(1)} dB (band ${firstKept.band.toFixed(1)} m) → run #${kept}: ${lastKept.db.toFixed(1)} dB (band ${lastKept.band.toFixed(1)} m)`);
    console.log(`memory at end: ${memory.count()} lessons`);
  }
})();