import type { Geometry } from '../ui/geometry.js';

/** What the agent sees of the live simulation (numbers and honest physics only — never personal data). */
export type AgentState = {
  reductionDb: number;
  leadMs: number;
  geometry: Geometry;
  zoneDepth: Array<{ freqHz: number; depthDb: number }>;
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