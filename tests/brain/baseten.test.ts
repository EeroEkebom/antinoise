// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createBasetenRoute, systemPrompt } from '../../src/brain/baseten.js';
import type { AgentState } from '../../src/brain/brain.js';

const SAMPLE_STATE: AgentState = {
  reductionDb: 12.5,
  leadMs: 73,
  geometry: { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 },
  zoneDepth: [
    { freqHz: 63, depthDb: -4.2 },
    { freqHz: 100, depthDb: -6.1 },
    { freqHz: 250, depthDb: -3.0 },
    { freqHz: 630, depthDb: -1.2 },
  ],
  goal: 'depth',
  bandMeters: 5.2,
  memory: [],
};

const VALID_REPLY = {
  choices: [{
    message: {
      role: 'assistant',
      content: '{"kind":"apply","geometry":{"towerMeters":25,"zoneMeters":30,"standoffMeters":5,"y":0.5,"trafficLevel":1,"speakers":3},"mu":0.1,"note":"spreading the array widens the honest band"}',
    },
  }],
};

const REASONING_TRUNCATED = {
  choices: [{ message: { role: 'assistant', content: null, reasoning_content: 'user wants... let me think about geometry' } }],
};

const PROSE_WRAPPED = {
  choices: [{ message: { role: 'assistant', content: 'Here is my plan:\n```json\n{"kind":"apply","geometry":{"towerMeters":22,"zoneMeters":30,"standoffMeters":5,"y":0.5,"trafficLevel":1,"speakers":2},"mu":0.05,"note":"a calmer first pass"}\n```' } }],
};

const OUT_OF_RANGE = {
  choices: [{ message: { role: 'assistant', content: '{"kind":"apply","geometry":{"towerMeters":2,"zoneMeters":30,"standoffMeters":0.1,"y":0.5,"trafficLevel":1,"speakers":99},"mu":0.05,"note":"this must be rejected"}' } }],
};

function routeWithReply(...replies: unknown[]) {
  let call = 0;
  const fetches: unknown[] = replies;
  return {
    route: createBasetenRoute('test-key', async () => fetches[Math.min(call++, fetches.length - 1)]),
    calls: () => call,
  };
}

describe('BasetenRoute', () => {
  test('well-formed content JSON → parsed decision', async () => {
    const { route } = routeWithReply(VALID_REPLY);
    const d = await route.propose(SAMPLE_STATE);
    expect(d).toHaveProperty('kind', 'apply');
    if (d.kind === 'apply') {
      expect(d.geometry.towerMeters).toBe(25);
      expect(d.geometry.speakers).toBe(3);
      expect(d.note).toContain('widens');
    }
  });

  test('reasoning-only reply (content null) → one retry with 2× budget, then typed failure', async () => {
    const { route, calls } = routeWithReply(REASONING_TRUNCATED, VALID_REPLY);
    const d = await route.propose(SAMPLE_STATE);
    expect(d).toHaveProperty('kind', 'apply'); // retry succeeded
    expect(calls()).toBe(2);
  });

  test('reasoning-only on both attempts → typed unavailable (never a hang, never a corrupted apply)', async () => {
    const { route } = routeWithReply(REASONING_TRUNCATED);
    const d = await route.propose(SAMPLE_STATE);
    expect(d).toHaveProperty('kind', 'unavailable');
  });

  test('prose-wrapped / fenced JSON → extracted', async () => {
    const { route } = routeWithReply(PROSE_WRAPPED);
    const d = await route.propose(SAMPLE_STATE);
    expect(d).toHaveProperty('kind', 'apply');
    if (d.kind === 'apply') expect(d.geometry.speakers).toBe(2);
  });

  test('out-of-range geometry → typed unavailable, geometry untouched, no throw', async () => {
    const { route } = routeWithReply(OUT_OF_RANGE);
    const d = await route.propose(SAMPLE_STATE);
    expect(d).toHaveProperty('kind', 'unavailable');
  });

  test('HTTP 429 → typed unavailable', async () => {
    const route = createBasetenRoute('test-key', async () => ({ status: 429, statusText: 'Too Many Requests' }));
    const d = await route.propose(SAMPLE_STATE);
    expect(d).toHaveProperty('kind', 'unavailable');
  });

  test('a thrown fetch error mentioning the key is redacted in the reason', async () => {
    const route = createBasetenRoute('test-key', async () => {
      throw new Error('Headers.append: "Bearer b10_SECRETSECRETSECRET.abc123" is an invalid header value.');
    });
    const d = await route.propose(SAMPLE_STATE);
    const reason = d.kind === 'unavailable' ? d.reason : '';
    expect(reason).not.toContain('b10_SECRET');
    expect(reason).toContain('<redacted>');
  });
});
describe('spacing knob (audit P1 #6 regression)', () => {
  test('model-proposed spacingMeters parses through to the geometry', async () => {
    const reply = { choices: [{ message: { role: 'assistant', content: '{"kind":"apply","geometry":{"towerMeters":25,"zoneMeters":30,"standoffMeters":5,"y":0.5,"trafficLevel":1,"speakers":3,"spacingMeters":2},"mu":0.1,"note":"spread via 2 m spacing"}' } }] };
    const { route } = routeWithReply(reply);
    const d = await route.propose(SAMPLE_STATE);
    expect(d.kind).toBe('apply');
    expect(d.kind === 'apply' && d.geometry.spacingMeters).toBe(2);
  });

  test('missing spacing → current spacing kept (absent key, not a 0)', async () => {
    const reply = { choices: [{ message: { role: 'assistant', content: VALID_REPLY.choices[0].message.content } }] };
    const { route } = routeWithReply(reply);
    const d = await route.propose(SAMPLE_STATE);
    expect(d.kind === 'apply' && d.geometry.spacingMeters).toBeUndefined();
  });

  test('out-of-range spacing → proposal rejected by feasibility physics', async () => {
    const reply = { choices: [{ message: { role: 'assistant', content: '{"kind":"apply","geometry":{"towerMeters":25,"zoneMeters":30,"standoffMeters":5,"y":0.5,"trafficLevel":1,"speakers":3,"spacingMeters":12},"mu":0.1,"note":"spacing 12"}' } }] };
    const { route } = routeWithReply(reply);
    const d = await route.propose(SAMPLE_STATE);
    expect(d.kind).toBe('unavailable');
  });

  test('traffic level from the model never overrides the user knob (audit #15)', async () => {
    const { route } = routeWithReply({ choices: [{ message: { role: 'assistant', content: '{"kind":"apply","geometry":{"towerMeters":25,"zoneMeters":30,"standoffMeters":5,"y":0.5,"trafficLevel":1,"speakers":3},"mu":0.1,"note":"n"}' } }] });
    const d = await route.propose({ ...SAMPLE_STATE, geometry: { ...SAMPLE_STATE.geometry, trafficLevel: 1.4 } });
    expect(d.kind).toBe('apply'); // parsed fine — the reset to the user's level happens in applyDecision (loop tests)
  });
});

describe('systemPrompt (goal-aware)', () => {
  test('depth goal: targets the measured point dB; band width is context only', () => {
    const p = systemPrompt('depth');
    expect(p).toContain('reductionDb');
    expect(p).toContain('context, not the target');
    expect(p).not.toContain('MAY accept a reductionDb drop');
  });

  test('area goal: targets band width, allows a small dB trade, still bans fake dB claims', () => {
    const p = systemPrompt('area');
    expect(p).toContain('bandMeters');
    expect(p).toContain('under ~3 dB');
    expect(p).toContain('never promise measured-dB gains'); // honesty survives the goal switch
  });

  test('both goals keep the memory-protocol line and the honest stand-down rule', () => {
    for (const goal of ['depth', 'area'] as const) {
      const p = systemPrompt(goal);
      expect(p).toContain('memory');
      expect(p).toContain('Be honest');
    }
  });
});
