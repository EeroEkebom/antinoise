import './style.css';
import { runScenario, type ScenarioConfig, type ScenarioResult } from './core/scenario.js';
import { prepareAudioBuffers } from './audio/bridge.js';
import { validateGeometry, geometryToScenarioConfig, leadMs, type Geometry } from './ui/geometry.js';
import { renderField, hitTest, pxToMeters, type Marker } from './ui/fieldViz.js';
import { createAgentConsole } from './ui/agentConsole.js';
import { proposeTurn, applyDecision } from './brain/loop.js';
import type { AgentDecision, Brain } from './brain/brain.js';
import { parseSamBoxes, interpretPlacement, type PlacementProposal } from './brain/placement.js';
import { createTour } from './ui/tour.js';
import { createSessionBest, setupLabel } from './ui/sessionBest.js';

const agentConsole = createAgentConsole(el('agent-console'));
agentConsole.setStatus('idle — brain: muse-spark-open-1026 on Baseten (via /api/brain proxy)', false);

/** Browser-side brain: talks to the dev-server proxy, which alone holds the API key. */
const proxyBrain: Brain = {
  propose: async (state): Promise<AgentDecision> => {
    const res = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    return (await res.json()) as AgentDecision;
  },
};

const SEEDS = [42, 7, 99];

type Audio = { ctx: AudioContext; gainOpen: GainNode; gainClosed: GainNode; srcOpen: AudioBufferSourceNode | null; srcClosed: AudioBufferSourceNode | null };
let audio: Audio | null = null;
const geo: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };
let seed = SEEDS[0];
let freqHz = 100;
let sourceSignal: Float32Array | null = null; // active external recording (16 kHz sim signal), or null = synthetic
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

// session-best tracker + setup library (localStorage = this viewer's browser only)
const sessionBest = createSessionBest();
type SavedSetup = { name: string; geometry: Geometry; note: string };
const LS_KEY = 'antinoise.setups.v1';
function loadSetups(): SavedSetup[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SavedSetup[]) : [];
  } catch {
    return [];
  }
}
function persistSetups(list: SavedSetup[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // private mode / storage blocked → setups live only this session
  }
}
let setups = loadSetups();

function renderSetups(): void {
  const wrap = el('setups');
  wrap.innerHTML = '';
  for (const s of setups) {
    const chip = document.createElement('button');
    chip.className = 'chip';
    chip.title = `${s.note} · ${setupLabel(s.geometry)} — click to load`;
    chip.textContent = `★ ${s.name}`;
    chip.addEventListener('click', () => {
      geo.towerMeters = s.geometry.towerMeters;
      geo.zoneMeters = s.geometry.zoneMeters;
      geo.standoffMeters = s.geometry.standoffMeters;
      geo.speakers = s.geometry.speakers;
      geo.spacingMeters = s.geometry.spacingMeters;
      rerun();
      agentConsole.log({ state: 'saved setup loaded', decision: s.name, applied: setupLabel(s.geometry) });
    });
    const del = document.createElement('button');
    del.className = 'chip-del';
    del.textContent = '×';
    del.title = 'delete this saved setup';
    del.addEventListener('click', () => {
      setups = setups.filter((x) => x !== s);
      persistSetups(setups);
      renderSetups();
    });
    const pair = document.createElement('span');
    pair.className = 'chip-pair';
    pair.appendChild(chip);
    pair.appendChild(del);
    wrap.appendChild(pair);
  }
}
el('btn-save-setup').addEventListener('click', () => {
  const name = el<HTMLInputElement>('setup-name').value.trim() || `setup ${setups.length + 1}`;
  const best = sessionBest.current();
  const note = best && Math.abs(best.db - (result?.reductionDb ?? 0)) < 0.05 ? 'this was the session best' : 'user-saved';
  setups.push({ name, geometry: { ...geo, spacingMeters: geo.spacingMeters }, note });
  persistSetups(setups);
  el<HTMLInputElement>('setup-name').value = '';
  renderSetups();
  agentConsole.log({ state: 'setup saved', decision: name, applied: setupLabel(geo) });
  el('setups-saver').hidden = false;
  void best;
});

el('btn-best').addEventListener('click', () => {
  const bestGeo = sessionBest.restore();
  if (!bestGeo) return;
  geo.towerMeters = bestGeo.towerMeters;
  geo.zoneMeters = bestGeo.zoneMeters;
  geo.standoffMeters = bestGeo.standoffMeters;
  geo.speakers = bestGeo.speakers;
  geo.spacingMeters = bestGeo.spacingMeters;
  rerun();
  agentConsole.log({ state: 'returned to session best', decision: 'go to best', applied: setupLabel(geo) });
});

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
  if (sourceSignal) cfg.sourceSignal = sourceSignal; // real-recording preset when loaded
  try {
    result = runScenario(cfg);
  } catch (e) {
    banner(e instanceof Error ? e.message : String(e));
    return;
  }
  el('v-db').textContent = `${result.reductionDb.toFixed(1)} dB`;
  el('v-lead').textContent = `${leadMs(geo).toFixed(0)} ms`;
  // traffic loudness at the zone vs the roadside: line-source gain 10/(10+d)
  const ambDb = 20 * Math.log10(10 / (10 + geo.zoneMeters));
  el('v-amb').textContent = `${ambDb.toFixed(1)} dB vs roadside`;
  el('v-geo').textContent = `towers ${geo.towerMeters.toFixed(0)} m · zone ${geo.zoneMeters.toFixed(0)} m · array ${geo.standoffMeters.toFixed(1)} m · ${geo.speakers} nodes @ ${geo.spacingMeters ?? 4} m`;
  if (audio) void rebuildAudioLoops(result);
  draw();

  // session-best tracker (skips infeasible-throw configs, which never reach here)
  sessionBest.consider(result.reductionDb, geo);
  el('v-best').textContent = sessionBest.current()?.db.toFixed(1) + ' dB';
  el('btn-best').hidden = false;
  el('setups-saver').hidden = false;
}

function rebuildAudioLoops(r: ScenarioResult): Promise<void> {
  if (!audio) return Promise.resolve();
  const ctx = audio.ctx;
  return ctx.resume().then(() => {
    const buffered = prepareAudioBuffers({ open: r.openLoop, closed: r.closedLoop }, ctx.sampleRate);
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
    // rebuild the looping pair in place: stop the old sources first (one pair plays at a time)
    if (audio!.srcOpen) {
      try { audio!.srcOpen.stop(); } catch { /* already stopped */ }
      try { audio!.srcOpen.disconnect(); } catch { /* already disconnected */ }
    }
    if (audio!.srcClosed) {
      try { audio!.srcClosed.stop(); } catch { /* already stopped */ }
      try { audio!.srcClosed.disconnect(); } catch { /* already disconnected */ }
    }
    open.connect(audio!.gainOpen);
    closed.connect(audio!.gainClosed);
    open.start();
    closed.start();
    audio!.srcOpen = open;
    audio!.srcClosed = closed;
  });
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
  audio = { ctx, gainOpen, gainClosed, srcOpen: null, srcClosed: null };
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
el('btn-tour-mini').addEventListener('click', () => el<HTMLButtonElement>('btn-tour').click());
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
const REAL_SOURCES: { file: string; label: string; note: string }[] = [
  { file: 'traffic-city-highway', label: 'City highway', note: 'CC0 · sotiris_laskaris (Freesound #563698)' },
  { file: 'traffic-motorway-m6', label: 'Motorway M6', note: 'CC0 · JW_audio (Freesound #826246)' },
  { file: 'traffic-us-hwy64-wet', label: 'US highway (wet)', note: 'CC0 · reg7783 (Freesound #632640)' },
];
const recordingCache = new Map<string, Float32Array>();

async function loadRecording(file: string): Promise<Float32Array> {
  const hit = recordingCache.get(file);
  if (hit) return hit;
  const res = await fetch(`/audio/${file}.wav`);
  const ab = await res.arrayBuffer();
  const probe = new AudioContext();
  const decoded = await probe.decodeAudioData(ab);
  void probe.close();
  const off = new OfflineAudioContext(1, decoded.length, 16000);
  const s = off.createBufferSource();
  s.buffer = decoded;
  s.connect(off.destination);
  s.start();
  const rendered = await off.startRendering();
  const sig = rendered.getChannelData(0).slice();
  recordingCache.set(file, sig);
  return sig;
}
const btnSynthetic = document.createElement('button');
btnSynthetic.textContent = 'Synthetic traffic';
btnSynthetic.classList.add('active');
btnSynthetic.title = 'The seeded synthetic source (the test bed)';
btnSynthetic.addEventListener('click', () => {
  sourceSignal = null;
  el('traffic-note').textContent = 'Source: the seeded synthetic traffic (the test bed — fully reproducible).';
  for (const c of el('scenarios').children) c.classList.toggle('active', c === btnSynthetic);
  rerun();
});
el('scenarios').appendChild(btnSynthetic);
for (const rs of REAL_SOURCES) {
  const b = document.createElement('button');
  b.textContent = `Real: ${rs.label}`;
  b.title = `${rs.note} — real recordings, CC0 / public domain`;
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      sourceSignal = await loadRecording(rs.file);
      el('traffic-note').textContent = `Source: real recording — ${rs.note}.`;
      for (const c of el('scenarios').children) c.classList.toggle('active', c === b);
      rerun();
    } catch {
      b.classList.add('failed');
    } finally {
      b.disabled = false;
    }
  });
  el('scenarios').appendChild(b);
}
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
  if (lv === geo.trafficLevel) b.classList.add('active'); // default: Normal (=1)
  b.addEventListener('click', () => {
    geo.trafficLevel = lv;
    for (const c of el('traffic').children) c.classList.toggle('active', c === b);
    applyTrafficLevel();
  });
  el('traffic').appendChild(b);
  void label;
}
el('traffic-note').textContent = 'Source: the seeded synthetic traffic (the test bed — fully reproducible). Cancelled stream is at Normal level.';

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

// node spacing knob (vertical spread of the array; 1–8 m physical)
for (const s of [2, 4, 6]) {
  const b = document.createElement('button');
  b.textContent = `${s} m`;
  if ((geo.spacingMeters ?? 4) === s) b.classList.add('active');
  b.addEventListener('click', () => {
    geo.spacingMeters = s;
    for (const c of el('spacing').children) c.classList.toggle('active', c === b);
    rerun();
  });
  el('spacing').appendChild(b);
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

// photo → SAM 3.1 → placement proposal (user confirms before applying)
const EXAMPLE_PHOTO = 'https://upload.wikimedia.org/wikipedia/commons/9/9b/Traffic_jam_Sao_Paulo_09_2006_30a.jpg';
el('btn-example').addEventListener('click', () => {
  el<HTMLInputElement>('photo-url').value = EXAMPLE_PHOTO;
});
let proposal: PlacementProposal | null = null;
el('btn-seg').addEventListener('click', async () => {
  const b = el<HTMLButtonElement>('btn-seg');
  const noteEl = el<HTMLParagraphElement>('place-note');
  const url = el<HTMLInputElement>('photo-url').value.trim();
  if (!url) {
    noteEl.textContent = 'paste a photo URL first';
    return;
  }
  b.disabled = true;
  noteEl.textContent = 'segmenting with SAM 3.1 (two passes: road, open ground)…';
  try {
    const seg = async (prompt: string): Promise<string> => {
      const r = await fetch('/api/sam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl: url, prompt }) });
      const j = (await r.json()) as { ok: boolean; output?: string; reason?: string };
      if (!j.ok) throw new Error(j.reason ?? 'segmentation failed');
      return j.output ?? '';
    };
    const road = parseSamBoxes(await seg('road'));
    const zone = parseSamBoxes(await seg('open ground'));
    proposal = interpretPlacement({ road, zone }, 1, 1);
    noteEl.textContent = proposal.note;
    agentConsole.log({ state: 'photo segmented', decision: 'placement proposed', applied: `tower ${proposal.towerMeters} m · zone ${proposal.zoneMeters} m · ${proposal.speakers} nodes` });
    el<HTMLButtonElement>('btn-apply-place').disabled = proposal.fallback;
  } catch (e) {
    noteEl.textContent = e instanceof Error ? e.message : 'segmentation failed';
    el<HTMLButtonElement>('btn-apply-place').disabled = true;
  } finally {
    b.disabled = false;
  }
});
el('btn-apply-place').addEventListener('click', () => {
  if (!proposal || proposal.fallback) return;
  geo.towerMeters = proposal.towerMeters;
  geo.zoneMeters = proposal.zoneMeters;
  geo.standoffMeters = proposal.standoffMeters;
  geo.speakers = proposal.speakers;
  rerun();
  agentConsole.log({ state: 'proposal confirmed', decision: 'applied to geometry', applied: 'field re-run with photo-derived placement' });
});

// guided tour: walks the page, scrolls + highlights each section
const tourHost = document.createElement('div');
tourHost.id = 'tour';
document.getElementById('app')!.appendChild(tourHost);
el('btn-tour').addEventListener('click', () => {
  tourHost.innerHTML = '';
  createTour(tourHost, {
    onFocus: (id) => {
      for (const c of tourHost.parentElement?.parentElement?.querySelectorAll('.tour-on') ?? [])
        c.classList.remove('tour-on');
      if (!id) return;
      const target = document.getElementById(id.startsWith('listen-knobs') ? 'listen' : id);
      target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target?.classList.add('tour-on');
    },
  });
});

// consult the real commissioning agent (Muse Spark Open via the dev proxy — the key never reaches the browser)
// the AI tuning assistant: propose → USER REVIEWS → apply (one by one or all) → before/after A/B
type AgentReview = {
  decision: Extract<AgentDecision, { kind: 'apply' }>;
  preGeo: Geometry;
  preResult: ScenarioResult;
};
let agentReview: AgentReview | null = null;
let postAgentResult: (ScenarioResult & { geometry: Geometry }) | null = null;

el('btn-agent').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-agent');
  btn.disabled = true;
  try {
    const r: ScenarioResult | null = result;
    if (!r) return;
    const review = await proposeTurn(proxyBrain, geo, r, agentConsole);
    if (review.decision.kind === 'unavailable') {
      el('review').hidden = true;
      return;
    }
    agentReview = { decision: review.decision, preGeo: { ...geo }, preResult: r };
    renderReview(review.decision);
  } finally {
    btn.disabled = false;
  }
});

const PARAM_LABELS: [string, string][] = [
  ['towerMeters', 'Sensor tower distance'],
  ['zoneMeters', 'Quiet-zone distance'],
  ['standoffMeters', 'Array standoff'],
  ['speakers', 'Array nodes'],
  ['spacingMeters', 'Node spacing'],
];

function renderReview(decision: Extract<AgentDecision, { kind: 'apply' }>): void {
  const fmt = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const g = decision.geometry as unknown as Record<string, number | undefined>;
  const rows = el('review-rows');
  rows.innerHTML = '';
  for (const [key, label] of PARAM_LABELS) {
    const proposed = g[key];
    const current = (geo as unknown as Record<string, number | undefined>)[key] as number | undefined;
    if (proposed === undefined || proposed === current) continue;
    const row = document.createElement('label');
    row.className = 'review-row';
    row.innerHTML = `<input type="checkbox" checked data-p="${key}"> <span>${label}: <b>${fmt(current ?? 0)}</b> → <b class="new">${fmt(proposed)}</b></span>`;
    rows.appendChild(row);
  }
  if (decision.mu !== undefined) {
    rows.appendChild(Object.assign(document.createElement('label'), {
      className: 'review-row',
      innerHTML: `<input type="checkbox" checked data-p="mu"> <span>Adaptation rate μ: → <b class="new">${fmt(decision.mu)}</b></span>`,
    }));
  }
  el('review-note').textContent = decision.note ? `The assistant's suggestion — “${decision.note}” — accept what you like:` : 'Proposed changes — accept what you like:';
  agentConsole.stopThinking('proposal ready');
  el('review').hidden = false;
}

function checkedParams(): string[] {
  return Array.from(el('review-rows').querySelectorAll<HTMLInputElement>('input:checked')).map((i) => i.dataset.p!);
}

function afterAgent(next: ScenarioResult & { geometry: Geometry }): void {
  el('review').hidden = true;
  el('agent-ab').hidden = !agentReview;
  geo.towerMeters = next.geometry.towerMeters;
  geo.zoneMeters = next.geometry.zoneMeters;
  geo.standoffMeters = next.geometry.standoffMeters;
  geo.speakers = next.geometry.speakers;
  if (next.geometry.spacingMeters !== undefined) geo.spacingMeters = next.geometry.spacingMeters;
  rerun();
  postAgentResult = next;
  el('btn-post-agent')!.textContent = `After tuning (${next.reductionDb.toFixed(1)} dB)`;
  if (agentReview) {
    el('btn-pre-agent')!.textContent = `Before tuning (${agentReview.preResult.reductionDb.toFixed(1)} dB)`;
    if (audio) void toggleAgentStream('post');
  }
}

function toggleAgentStream(which: 'pre' | 'post'): void {
  const target = which === 'pre' ? agentReview?.preResult : postAgentResult;
  if (!target) return;
  void rebuildAudioLoops(target).then(() => {
    // closed-loop (field ON) is the relevant side for the before/after comparison
    audio && toggle('closed');
  });
  el('btn-pre-agent').classList.toggle('active', which === 'pre');
  el('btn-post-agent').classList.toggle('active', which === 'post');
}

el('btn-apply-sel').addEventListener('click', async () => {
  if (!agentReview || !result) return;
  const only = checkedParams();
  const next = only.includes('mu') && !only.some((p) => PARAM_LABELS.some(([k]) => k === p))
    ? null
    : await applyDecision(geo, result, agentReview.decision, agentConsole, { only: only.filter((p) => p !== 'mu') as never, sourceSignal: sourceSignal ?? undefined });
  // μ-only selection can't rerun the scenario — fold it in as an all-apply lite
  const nextFinal = next ?? (await applyDecision(geo, result, agentReview.decision, agentConsole, { sourceSignal: sourceSignal ?? undefined }));
  afterAgent(nextFinal);
});

el('btn-apply-all').addEventListener('click', async () => {
  if (!agentReview || !result) return;
  const next = await applyDecision(geo, result, agentReview.decision, agentConsole, { sourceSignal: sourceSignal ?? undefined });
  afterAgent(next);
});

el('btn-discard').addEventListener('click', () => {
  agentConsole.log({ state: agentReview ? `${agentReview.preResult.reductionDb.toFixed(1)} dB` : '—', decision: 'user discarded the proposal', applied: 'geometry unchanged' });
  agentReview = null;
  el('review').hidden = true;
  el('agent-ab').hidden = true;
});

el('btn-pre-agent')!.addEventListener('click', () => toggleAgentStream('pre'));
el('btn-post-agent')!.addEventListener('click', () => toggleAgentStream('post'));

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
  if (dragging === 'tower') geo.towerMeters = clampTower(m);
  if (dragging === 'zone') geo.zoneMeters = clampZone(m);
  if (dragging === 'speaker') {
    geo.standoffMeters = clampStandoff(geo.zoneMeters - m); // array keeps its standoff from the zone (by design)
  }
  canvas.classList.add('dragging');
  draw(dragging);
});
canvas.addEventListener('pointerup', () => {
  dragging = null;
  canvas.classList.remove('dragging');
  rerun(); // full re-run only here (not per move — frame budget)
});

// live clamps — strict physical order: road < sensor tower < cancel array < quiet zone
const TOWER_MIN = 8; // m from the road; the sensor never sits in the noise it listens to
function clampTower(m: number): number {
  return Math.max(TOWER_MIN, Math.min(geo.zoneMeters - geo.standoffMeters - 2, m));
}
function clampZone(m: number): number {
  const minZone = geo.towerMeters + geo.standoffMeters + 3.4; // keeps the fiber lead physically meaningful
  return Math.max(minZone, Math.min(59, m));
}
function clampStandoff(s: number): number {
  // the array always stays tower-side of the zone and never nearer the road than the sensor
  const maxS = Math.min(25, geo.zoneMeters - Math.max(TOWER_MIN, geo.towerMeters) - 2);
  return Math.max(0.5, Math.min(s, maxS));
}

window.addEventListener('resize', () => draw());
rerun(); // initial draw + readout wiring (audio stays off until first gesture)