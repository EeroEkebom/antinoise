/** Manual gate: one live call to the hackathon model on Baseten. Key from env (BASETEN_API_KEY); never committed. */
import { readFileSync } from 'node:fs';
import { createBasetenRoute } from '../brain/baseten.js';
import type { AgentState } from '../brain/brain.js';
import { runScenario } from '../core/scenario.js';
import { leadMs, type Geometry } from '../ui/geometry.js';
import { zoneDepthDb } from '../ui/fieldViz.js';

const geo: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };
const result = runScenario({ seed: 42, towerSeparationMeters: 20, zoneSeparationMeters: 30, sampleCount: 160000, mu: 0.05 });

const state: AgentState = {
  reductionDb: result.reductionDb,
  leadMs: leadMs(geo),
  geometry: geo,
  zoneDepth: [63, 100, 250, 630].map((f) => ({ freqHz: f, depthDb: zoneDepthDb(geo, 20, f) })),
};

let key = process.env.BASETEN_API_KEY ?? '';
if (!key) {
  try {
    const txt = readFileSync('/Users/eeroekebom/projects/additional_utilization/baseten/baseten.rtf', 'utf8');
    const plain = txt.replace(/\\[a-z]+[0-9]*[ ]?/g, '').replace(/[{}\\]/g, '').trim();
    key = plain.split('\n').find((l) => l.length > 20 && /[A-Za-z0-9]/.test(l)) ?? '';
  } catch {
    // fall through
  }
}
if (!key) {
  console.error('no API key: set BASETEN_API_KEY or place the key file');
  process.exit(2);
}

const brain = createBasetenRoute(key);
const decision = await brain.propose(state);
console.log('state:', JSON.stringify({ reductionDb: state.reductionDb, leadMs: state.leadMs, zoneDepth: state.zoneDepth.map((z) => `${z.freqHz}Hz:${z.depthDb.toFixed(1)}dB`) }));
console.log('decision:', JSON.stringify(decision, null, 2));