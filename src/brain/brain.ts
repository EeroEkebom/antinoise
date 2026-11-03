import type { Geometry } from '../ui/geometry.js';

/** What the agent optimizes: 'depth' = the measured point dB (default), 'area' = the quiet band width.
 *  Physically these trade off — 'area' may spend a little dB to gain band width; 'depth' never trades. */
export type AgentGoal = 'depth' | 'area';

/** What the agent sees of the live simulation (numbers and honest physics only — never personal data). */
export type AgentState = {
  reductionDb: number;
  leadMs: number;
  geometry: Geometry;
  zoneDepth: Array<{ freqHz: number; depthDb: number }>;
  goal: AgentGoal;
  bandMeters: number; // quiet band width on the map — the 'area' goal's metric
  memory: string[]; // precedents from past accepted turns (measured outcomes) — the agent's long-term memory
};

/** What the agent may do. 'apply' carries validated knobs + a one-sentence note for the console. */
export type AgentDecision =
  | { kind: 'apply'; geometry: Geometry; mu?: number; note: string }
  | { kind: 'unavailable'; reason: string };

/** Route-agnostic brain: the sim never knows whether the model came from Baseten, the Meta API, or self-hosted weights. */
export type Brain = {
  propose(input: AgentState): Promise<AgentDecision>;
};

export const BRAIN_MODEL = 'meta-models/muse-spark-open-1026';
export const BASETEN_BASE_URL = 'https://inference.baseten.co/v1';