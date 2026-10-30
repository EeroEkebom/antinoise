import { validateGeometry } from '../ui/geometry.js';
import { BASETEN_BASE_URL, BRAIN_MODEL, type AgentDecision, type AgentState, type Brain } from './brain.js';

type Fetcher = (url: string, init: RequestInit) => Promise<unknown>;

type Reply = {
  status?: number;
  statusText?: string;
  choices?: Array<{ message?: { content?: string | null; reasoning_content?: string | null } }>;
};

const SYSTEM_PROMPT = [
  'You are the commissioning engineer of Antinoise, a simulated feedforward road-noise-cancellation system.',
  'You receive live state: quiet-zone reduction (dB), fiber lead (ms), current geometry, and per-frequency zone depth.',
  'You propose ONE improvement. Reply with ONLY a JSON object, no other text:',
  '{"kind":"apply","geometry":{"towerMeters":N,"zoneMeters":N,"standoffMeters":N,"y":0.5,"trafficLevel":1,"speakers":N},"mu":N,"note":"one human sentence explaining the change"}',
  'Allowed knobs: towerMeters 5–59 (sensor distance from road; more = longer fiber lead), zoneMeters 10–59,',
  'standoffMeters 0.5–25 (array to zone), speakers 1–5 (integer, wider honest quiet band), mu 0.01–0.3 (adaptation).',
  'Physics you must respect: lead = (zone − tower − standoff)/343 m ≥ ~10 ms needs tower ≤ zone − standoff − 3.4 m;',
  'wavelength caps the quiet band: high frequencies cannot be cancelled by more hardware.',
  'Be honest: if the current setup cannot be improved, reply {"kind":"apply", ...unchanged geometry..., "note":"no change — already near optimal"} or explain the physical limit.',
].join('\n');

/** OpenAI-compatible route to the hackathon model on Baseten — a reasoning model: budget tokens for its thinking. */
export function createBasetenRoute(apiKey: string, fetchFn: Fetcher = fetch as unknown as Fetcher): Brain {
  const call = async (maxTokens: number, state: AgentState): Promise<Reply> => {
    const res = (await fetchFn(`${BASETEN_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: BRAIN_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(state) },
        ],
        max_tokens: maxTokens,
        temperature: 0.2,
      }),
    })) as Reply & { json?: () => Promise<unknown>; ok?: boolean };
    // real fetch returns a Response — parse it; fixture/429-shaped objects pass through
    if (res.choices === undefined && typeof res.json === 'function') {
      if (res.ok === false) throw new Error(`HTTP ${res.status} ${res.statusText ?? ''}`.trim());
      return (await res.json()) as Reply;
    }
    return res;
  };

  return {
    propose: async (state: AgentState): Promise<AgentDecision> => {
      let reply: Reply;
      let budget = 2048;
      const redact = (s: string): string => s.replace(/Bearer\s*[^"']+/gi, 'Bearer <redacted>').slice(0, 200);
      try {
        reply = await call(budget, state);
        if (!reply.choices) return { kind: 'unavailable', reason: `HTTP ${(reply as { status?: number }).status ?? '?'} ${(reply as { statusText?: string }).statusText ?? ''}`.trim() };
      } catch (e) {
        return { kind: 'unavailable', reason: redact(e instanceof Error ? e.message : String(e)) };
      }

      // reasoning model: with a small budget it can spend everything thinking and return content:null → retry with 2×
      let content = reply.choices?.[0]?.message?.content;
      if (content == null || content.trim() === '') {
        budget *= 2;
        try {
          reply = await call(budget, state);
          content = reply.choices?.[0]?.message?.content;
        } catch (e) {
          return { kind: 'unavailable', reason: redact(e instanceof Error ? e.message : String(e)) };
        }
        if (content == null || content.trim() === '') {
          return { kind: 'unavailable', reason: 'model spent its entire token budget reasoning — no decision content' };
        }
      }

      const obj = extractJson(content);
      if (!isApplyShape(obj)) return { kind: 'unavailable', reason: 'decision not a valid apply object' };
      const g = obj.geometry as Record<string, unknown>;
      const geometry = {
        towerMeters: Number(g.towerMeters),
        zoneMeters: Number(g.zoneMeters),
        standoffMeters: Number(g.standoffMeters),
        y: Number(g.y ?? 0.5),
        trafficLevel: Number(g.trafficLevel ?? 1),
        speakers: Math.round(Number(g.speakers ?? 1)),
      };
      if (![geometry.towerMeters, geometry.zoneMeters, geometry.standoffMeters].every(Number.isFinite))
        return { kind: 'unavailable', reason: 'geometry numbers missing or non-finite' };
      const v = validateGeometry(geometry);
      if (!v.ok) return { kind: 'unavailable', reason: `agent proposal rejected: ${v.message}` };
      const mu = obj.mu === undefined ? undefined : Number(obj.mu);
      return { kind: 'apply', geometry, mu, note: String(obj.note ?? '').slice(0, 200) };
    },
  };
}

/** First balanced {...} block; tolerates fences and surrounding prose. */
function extractJson(s: string): Record<string, unknown> | null {
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isApplyShape(o: unknown): o is Record<string, unknown> & { geometry: unknown } {
  if (typeof o !== 'object' || o === null) return false;
  return (o as { geometry?: unknown }).geometry !== undefined;
}