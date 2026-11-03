import type { Geometry } from './geometry.js';
import type { AgentGoal } from '../brain/brain.js';

/** One accepted + re-measured agent turn, filed for future suggestions.
 *  The agent's memory is a protocol, not weight-learning — like play-mud's player.md. */
export type AgentLesson = {
  goal: AgentGoal;
  source: string; // traffic source the turn ran on (synthetic | real file)
  geometry: Geometry;
  mu?: number;
  measuredDb: number;
  bandMeters: number;
  note: string; // the model's own one-sentence rationale for the move
};

type StorageLike = { get: (k: string) => string | null; set: (k: string, v: string) => void; remove: (k: string) => void };

const LS_KEY = 'antinoise.memory.v1';
const CAP = 12;

const m = (n: number): string => n.toFixed(0);

/* istanbul ignore next -- storage guard: viewer-only comfort, never load-bearing */
function defaultStorage(): StorageLike | null {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return null;
    return { get: (k) => ls.getItem(k), set: (k, v) => void ls.setItem(k, v), remove: (k) => void ls.removeItem(k) };
  } catch {
    return null; // private mode / storage blocked → the memory lives only this session
  }
}

export function createAgentMemory(store: StorageLike | null = defaultStorage()) {
  let lessons: AgentLesson[] = load();

  function load(): AgentLesson[] {
    try {
      const raw = store?.get(LS_KEY);
      return raw ? (JSON.parse(raw) as AgentLesson[]) : [];
    } catch {
      return [];
    }
  }
  function persist(): void {
    try {
      store?.set(LS_KEY, JSON.stringify(lessons));
    } catch {
      // storage blocked — the session's lessons still live in this instance
    }
  }

  return {
    record(lesson: AgentLesson): void {
      lessons.push(lesson);
      if (lessons.length > CAP) lessons = lessons.slice(lessons.length - CAP);
      persist();
    },
    count(): number {
      return lessons.length;
    },
    /** Compact lines the agent gets with each turn — evidence of what worked and what it measured. */
    precedents(): string[] {
      return lessons.map((l) => {
        const g = l.geometry;
        const mu = l.mu !== undefined ? ` · mu ${l.mu}` : '';
        return `goal: ${l.goal} · ${l.source === 'synthetic' ? 'synthetic' : `real: ${l.source}`} · tower ${m(g.towerMeters)}m zone ${m(g.zoneMeters)}m standoff ${m(g.standoffMeters)}m ${g.speakers} nodes · ${l.measuredDb.toFixed(1)} dB · band ${l.bandMeters.toFixed(1)} m${mu} — “${l.note}”`;
      });
    },
    clear(): void {
      lessons = [];
      try {
        store?.remove(LS_KEY);
      } catch {
        // storage blocked — nothing to remove anyway
      }
    },
  };
}

export type AgentMemory = ReturnType<typeof createAgentMemory>;