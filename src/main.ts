import './style.css';
import { CONFIG } from './core/rng.js';
import { runScenario } from './core/scenario.js';
import { prepareAudioBuffers } from './audio/bridge.js';
import type { ScenarioConfig } from './core/scenario.js';

const SCENARIOS: { name: string; cfg: ScenarioConfig }[] = [
  { name: 'Traffic A — morning', cfg: { seed: 42, towerSeparationMeters: 20, zoneSeparationMeters: 30, sampleCount: 160000, mu: 0.05 } },
  { name: 'Traffic B — heavy', cfg: { seed: 7, towerSeparationMeters: 20, zoneSeparationMeters: 30, sampleCount: 160000, mu: 0.05 } },
  { name: 'Traffic C — near zone', cfg: { seed: 99, towerSeparationMeters: 20, zoneSeparationMeters: 30, sampleCount: 160000, mu: 0.05 } },
];

type Audio = { ctx: AudioContext; open: AudioBuffer; closed: AudioBuffer; gainOpen: GainNode; gainClosed: GainNode };
let audio: Audio | null = null;

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

async function initAudio(cfg: ScenarioConfig): Promise<void> {
  const result = runScenario(cfg);
  const ctx = new AudioContext();
  const buffered = prepareAudioBuffers({ open: result.openLoop, closed: result.closedLoop }, ctx.sampleRate);
  const toBuffer = (arr: Float32Array): AudioBuffer => {
    const b = ctx.createBuffer(1, arr.length, ctx.sampleRate);
    b.copyToChannel(new Float32Array(arr), 0);
    return b;
  };

  // both streams loop from the same start instant; A/B is a gain swap (seamless compare)
  const gainOpen = ctx.createGain();
  const gainClosed = ctx.createGain();
  const open = toBuffer(buffered.open);
  const closed = toBuffer(buffered.closed);
  const srcOpen = ctx.createBufferSource();
  const srcClosed = ctx.createBufferSource();
  srcOpen.buffer = open;
  srcClosed.buffer = closed;
  srcOpen.loop = true;
  srcClosed.loop = true;
  gainOpen.gain.value = 0;
  gainClosed.gain.value = 1;
  const master = ctx.createGain();
  master.gain.value = 0.9; // headroom; bridge limiter guarantees <= 1
  srcOpen.connect(gainOpen).connect(master).connect(ctx.destination);
  srcClosed.connect(gainClosed).connect(master).connect(ctx.destination);
  srcOpen.start();
  srcClosed.start();
  audio = { ctx, open, closed, gainOpen, gainClosed };

  el('v-db').textContent = `${result.reductionDb.toFixed(1)} dB`;
  el('v-lead').textContent = `${(((cfg.zoneSeparationMeters - cfg.towerSeparationMeters - 5) / CONFIG.SPEED_OF_SOUND) * 1000).toFixed(0)} ms`;
  el('v-geo').textContent = `towers ${cfg.towerSeparationMeters} m · zone ${cfg.zoneSeparationMeters} m`;
  el('transport').hidden = false;
  el('readout').hidden = false;
}

function toggle(stream: 'open' | 'closed' | 'stop'): void {
  if (!audio) return;
  if (stream === 'stop') {
    audio.ctx.close();
    audio = null;
    el('transport').hidden = true;
    el('readout').hidden = true;
    return;
  }
  if (stream === 'open') {
    audio.gainOpen.gain.value = 1;
    audio.gainClosed.gain.value = 0;
  } else {
    audio.gainOpen.gain.value = 0;
    audio.gainClosed.gain.value = 1;
  }
  el('btn-noise').classList.toggle('active', stream === 'open');
  el('btn-quiet').classList.toggle('active', stream === 'closed');
}
for (const s of SCENARIOS) {
  const b = document.createElement('button');
  b.textContent = s.name;
  b.addEventListener('click', () => {
    if (audio) audio.ctx.close();
    void initAudio(s.cfg).then(() => toggle('closed'));
  });
  el('scenarios').appendChild(b);
}
el('btn-noise').addEventListener('click', () => toggle('open'));
el('btn-quiet').addEventListener('click', () => toggle('closed'));
el('btn-stop').addEventListener('click', () => toggle('stop'));