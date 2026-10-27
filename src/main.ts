import './style.css';
import { runScenario, type ScenarioConfig, type ScenarioResult } from './core/scenario.js';
import { prepareAudioBuffers } from './audio/bridge.js';
import { validateGeometry, geometryToScenarioConfig, leadMs, type Geometry } from './ui/geometry.js';
import { renderField, hitTest, pxToMeters, type Marker } from './ui/fieldViz.js';

const SEEDS = [42, 7, 99];

type Audio = { ctx: AudioContext; gainOpen: GainNode; gainClosed: GainNode };
let audio: Audio | null = null;
const geo: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };
let seed = SEEDS[0];
let freqHz = 100;
let result: ScenarioResult | null = null;
let dragging: Marker | null = null;

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function banner(msg: string | null): void {
  const b = el('banner');
  b.textContent = msg ?? '';
  b.hidden = !msg;
  el('listen').classList.toggle('invalid', !!msg);
}

function applyTrafficLevel(): void {
  if (!audio) return;
  audio.gainOpen.gain.setTargetAtTime(0.9 * geo.trafficLevel, audio.ctx.currentTime, 0.05);
  audio.gainClosed.gain.setTargetAtTime(0.9 * geo.trafficLevel, audio.ctx.currentTime, 0.05);
}

function rerun(): void {
  const v = validateGeometry(geo);
  if (!v.ok) {
    banner(v.message);
    return;
  }
  banner(null);
  const cfg: ScenarioConfig = geometryToScenarioConfig(geo, { seed, sampleCount: 160000 });
  try {
    result = runScenario(cfg);
  } catch (e) {
    banner(e instanceof Error ? e.message : String(e));
    return;
  }
  el('v-db').textContent = `${result.reductionDb.toFixed(1)} dB`;
  el('v-lead').textContent = `${leadMs(geo).toFixed(0)} ms`;
  el('v-geo').textContent = `towers ${geo.towerMeters.toFixed(0)} m · zone ${geo.zoneMeters.toFixed(0)} m · array ${geo.standoffMeters.toFixed(1)} m`;
  if (audio) rebuildAudio(cfg);
  draw();
}

async function rebuildAudio(cfg: ScenarioConfig): Promise<void> {
  if (!result) return;
  const ctx = audio!.ctx;
  await ctx.resume();
  const buffered = prepareAudioBuffers({ open: result.openLoop, closed: result.closedLoop }, ctx.sampleRate);
  const toBuffer = (arr: Float32Array): AudioBuffer => {
    const b = ctx.createBuffer(1, arr.length, ctx.sampleRate);
    b.copyToChannel(new Float32Array(arr), 0);
    return b;
  };
  // rebuild the looping pair in place: new sources, same gains
  const open = ctx.createBufferSource();
  const closed = ctx.createBufferSource();
  open.buffer = toBuffer(buffered.open);
  closed.buffer = toBuffer(buffered.closed);
  open.loop = true;
  closed.loop = true;
  open.connect(audio!.gainOpen);
  closed.connect(audio!.gainClosed);
  open.start();
  closed.start();
  void cfg;
}

function draw(highlight: Marker | null = null): void {
  const canvas = el<HTMLCanvasElement>('field');
  if (!canvas) return;
  renderField(canvas, geo, { highlight, freqHz });
}

async function initAudio(): Promise<void> {
  const ctx = new AudioContext();
  const gainOpen = ctx.createGain();
  const gainClosed = ctx.createGain();
  gainOpen.gain.value = 0;
  gainClosed.gain.value = 1;
  const master = ctx.createGain();
  master.gain.value = 0.9;
  gainOpen.connect(master);
  gainClosed.connect(master);
  master.connect(ctx.destination);
  audio = { ctx, gainOpen, gainClosed };
  el('transport').hidden = false;
  el('readout').hidden = false;
  el('field').hidden = false;
  document.getElementById('listen')?.classList.add('listening');
  rerun();
  applyTrafficLevel();
}

function toggle(stream: 'open' | 'closed'): void {
  if (!audio) return;
  audio.gainOpen.gain.value = stream === 'open' ? 1 : 0;
  audio.gainClosed.gain.value = stream === 'closed' ? 1 : 0;
  el('btn-noise').classList.toggle('active', stream === 'open');
  el('btn-quiet').classList.toggle('active', stream === 'closed');
}

// transport buttons: first gesture creates the AudioContext (autoplay policy)
el('btn-noise').addEventListener('click', () => {
  if (!audio) void initAudio().then(() => toggle('open'));
  else toggle('open');
});
el('btn-quiet').addEventListener('click', () => {
  if (!audio) void initAudio().then(() => toggle('closed'));
  else toggle('closed');
});
el('btn-stop').addEventListener('click', () => {
  if (audio) {
    audio.ctx.close();
    audio = null;
  }
  el('transport').hidden = true;
  el('readout').hidden = true;
});

// traffic mix picker
for (const s of SEEDS) {
  const b = document.createElement('button');
  b.textContent = `Traffic mix ${String.fromCharCode(65 + SEEDS.indexOf(s))}`;
  b.addEventListener('click', () => {
    for (const c of el('scenarios').children) c.classList.remove('active');
    b.classList.add('active');
    seed = s;
    rerun();
  });
  el('scenarios').appendChild(b);
}

// traffic level knob (audible loudness; reduction is scale-invariant — linear feedforward physics)
for (const [label, lv] of [['Light', 0.6], ['Normal', 1], ['Heavy', 1.4]] as [string, number][]) {
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.level = String(lv);
  b.addEventListener('click', () => {
    geo.trafficLevel = lv;
    for (const c of el('traffic').children) c.classList.toggle('active', c === b);
    applyTrafficLevel();
  });
  el('traffic').appendChild(b);
  void label;
}

// speaker-count knob: wider honest quiet band (nodes spread along the corridor)
for (const n of [1, 2, 3, 5]) {
  const b = document.createElement('button');
  b.textContent = `${n}`;
  if (n === geo.speakers) b.classList.add('active');
  b.addEventListener('click', () => {
    geo.speakers = n;
    for (const c of el('speakers').children) c.classList.toggle('active', c === b);
    rerun();
  });
  el('speakers').appendChild(b);
}

// wave-frequency selector: watch the quiet band shrink as the wavelength shortens — the physical honesty knob
for (const f of [63, 100, 250, 630]) {
  const b = document.createElement('button');
  b.textContent = `${f} Hz`;
  if (f === freqHz) b.classList.add('active');
  b.addEventListener('click', () => {
    freqHz = f;
    for (const c of el('waves').children) c.classList.toggle('active', c === b);
    draw();
  });
  el('waves').appendChild(b);
}

// drag interaction on the field
const canvas = el<HTMLCanvasElement>('field');
canvas.addEventListener('pointerdown', (ev) => {
  dragging = hitTest(canvas, geo, ev.offsetX, ev.offsetY);
  if (dragging) {
    canvas.setPointerCapture(ev.pointerId);
    draw(dragging);
  }
});
canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const m = Math.max(0.5, pxToMeters(ev.offsetX, canvas.clientWidth));
  if (dragging === 'tower') geo.towerMeters = Math.min(m, WORLDmax());
  if (dragging === 'zone') geo.zoneMeters = Math.min(m, WORLDmax());
  if (dragging === 'speaker') {
    geo.standoffMeters = Math.max(0.5, geo.zoneMeters - m); // array on the tower side of the zone
  }
  canvas.classList.add('dragging');
  draw(dragging);
});
canvas.addEventListener('pointerup', () => {
  dragging = null;
  canvas.classList.remove('dragging');
  rerun(); // full re-run only here (not per move — frame budget)
});

function WORLDmax(): number {
  return 59;
}

window.addEventListener('resize', () => draw());
rerun(); // initial draw + readout wiring (audio stays off until first gesture)