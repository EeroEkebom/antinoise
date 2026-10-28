// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createAgentConsole } from '../../src/ui/agentConsole.js';

describe('createAgentConsole', () => {
  test('renders newest-first trail rows with all three fields', () => {
    const host = document.createElement('div');
    const con = createAgentConsole(host);
    con.log({ state: 'depth 20.2 dB @ 100 Hz', decision: 'raise standoff for wider band', applied: 'standoff 5 → 7 m' });
    con.log({ state: 'idle', decision: 'standby', applied: 'none' });
    const rows = Array.from(host.querySelectorAll('.trail-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('idle'); // newest first
    expect(rows[0].textContent).toContain('standby');
    expect(rows[1].textContent).toContain('standoff 5 → 7 m');
  });

  test('header shows commissioning-agent status dot (idle until Wave 3 connects the brain)', () => {
    const host = document.createElement('div');
    createAgentConsole(host);
    const head = host.querySelector('.console-head');
    expect(head?.textContent).toContain('Commissioning agent');
    expect(head?.querySelector('.dot-idle')).toBeTruthy();
  });

  test('trail is capped (keeps the 50 newest, drops the oldest)', () => {
    const host = document.createElement('div');
    const con = createAgentConsole(host);
    for (let i = 0; i < 60; i++) con.log({ state: `s${i}`, decision: `d${i}`, applied: `a${i}` });
    expect(host.querySelectorAll('.trail-row')).toHaveLength(50);
    expect(host.querySelector('.trail-row')?.textContent).toContain('s59');
  });
});