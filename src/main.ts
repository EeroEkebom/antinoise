import './style.css';
import { runScenario, type ScenarioConfig, type ScenarioResult } from './core/scenario.js';
import { prepareAudioBuffers } from './audio/bridge.js';
import { validateGeometry, geometryToScenarioConfig, leadMs, type Geometry } from './ui/geometry.js';
import { renderField, hitTest, pxToMeters, quietBandMeters, type PhotoDerived, type Marker } from './ui/fieldViz.js';
import { createAgentConsole } from './ui/agentConsole.js';
import { proposeTurn, applyDecision } from './brain/loop.js';
import type { AgentDecision, AgentGoal, Brain } from './brain/brain.js';
import { parseSamBoxes, interpretPlacement, type PlacementProposal } from './brain/placement.js';
import { createTour } from './ui/tour.js';
import { createSessionBest, setupLabel } from './ui/sessionBest.js';
import { createAgentMemory } from './ui/agentMemory.js';

const agentConsole = createAgentConsole(el('agent-console'));
agentConsole.setStatus('idle — brain: muse-spark-open-1026 on Baseten (via /api/brain proxy)', false);

/** Browser-side brain: talks to the dev-server proxy, which alone holds the API key. */
const proxyBrain: Brain = {
  propose: async (state): Promise<AgentDecision> => {
    const res = await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
    return (await res.json()) as AgentDecision;
  },
};

const SYNTH_SEED = 42;

type Audio = { ctx: AudioContext; gainOpen: GainNode; gainClosed: GainNode; srcOpen: AudioBufferSourceNode | null; srcClosed: AudioBufferSourceNode | null };
let audio: Audio | null = null;
const geo: Geometry = { towerMeters: 20, zoneMeters: 30, standoffMeters: 5, y: 0.5, trafficLevel: 1, speakers: 1 };
let freqHz = 100;
let sourceSignal: Float32Array | null = null; // active external recording (16 kHz sim signal), or null = synthetic
let sourceKey = 'synthetic'; // which traffic source owns the session-best entry
let result: ScenarioResult | null = null;
let dragging: Marker | null = null;

// dev-only cursor visualizer (?cursor=1): browser tab capture excludes the system cursor, so the
// demo takes paint a pointer that follows the REAL mouse position — honest cue, no system privileges
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('cursor') === '1') {
  const dot = document.createElement('div');
  dot.id = 'cursor-dot';
  document.body.appendChild(dot);
  addEventListener('pointermove', (e) => {
    dot.style.left = String(e.clientX) + 'px';
    dot.style.top = String(e.clientY) + 'px';
    dot.style.display = 'block';
  }, { passive: true });
}

// dev-only take recorder (?record=1): capture THIS tab (picture + tab audio) → upload to /api/capture.
// The REC button removes itself once recording starts; the driver ends the take via window.__stopTake().
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('record') === '1') {
  const btn = document.createElement('button');
  btn.id = 'rec-btn';
  btn.textContent = '● REC';
  document.body.appendChild(btn);
  (window as unknown as Record<string, unknown>).__recOn = false;
  (window as unknown as Record<string, unknown>).__hasAudio = null;
  (window as unknown as Record<string, unknown>).__stopTake = () => {
    const w = window as unknown as { __stop?: () => void };
    w.__stop?.();
  };
  btn.addEventListener('click', async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser' },
        audio: true,
        preferCurrentTab: true,
      } as MediaStreamConstraints & { displaySurface?: string });
      const hasAudio = stream.getAudioTracks().length > 0;
      (window as unknown as Record<string, unknown>).__hasAudio = hasAudio;
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(stream, { mimeType: 'video/mp4', videoBitsPerSecond: 8_000_000 });
      rec.ondataavailable = (e) => { if ((e as BlobEvent).data.size) chunks.push((e as BlobEvent).data); };
      btn.remove(); // gone from the take
      const w = window as unknown as { __recOn: boolean; __stop?: (() => void) | null; __hasAudio: boolean | null; __uploaded?: boolean };
      w.__recOn = true;
      w.__stop = () => rec.stop();
      rec.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/mp4' });
        await fetch('/api/capture', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: blob });
        w.__recOn = false;
        w.__uploaded = true;
      };
      rec.start();
    } catch {
      (window as unknown as Record<string, unknown>).__recRefused = true;
    }
  });
}

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
// the agent's own memory: accepted turns + measured outcomes, feeds future suggestions (localStorage)
const agentMemory = createAgentMemory();
// optimization goal for the assistant: 'depth' (default, point dB) or 'area' (quiet band width)
let agentGoal: AgentGoal = 'depth';
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
      if (s.geometry.trafficLevel !== undefined) {
        geo.trafficLevel = s.geometry.trafficLevel;
        for (const c of el('traffic').children) {
          const cb = c as HTMLButtonElement;
          cb.classList.toggle('active', Number(cb.dataset.level) === geo.trafficLevel);
        }
        applyTrafficLevel();
      }
      rerun();
      agentConsole.log({ state: 'saved setup loaded', decision: s.name, applied: `${setupLabel(s.geometry)} @ ${geo.trafficLevel}× level` });
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
  const note = result && sessionBest.current(sourceKey) && Math.abs((sessionBest.current(sourceKey)?.db ?? 0) - result.reductionDb) < 0.05
    ? 'this was the session best'
    : 'user-saved';
  setups.push({ name, geometry: { ...geo, spacingMeters: geo.spacingMeters, trafficLevel: geo.trafficLevel }, note });
  persistSetups(setups);
  el<HTMLInputElement>('setup-name').value = '';
  renderSetups();
  agentConsole.log({ state: 'setup saved', decision: name, applied: setupLabel(geo) });
});

el('btn-best').addEventListener('click', () => {
  const bestGeo = sessionBest.restore(sourceKey);
  if (!bestGeo) return;
  geo.towerMeters = bestGeo.towerMeters;
  geo.zoneMeters = bestGeo.zoneMeters;
  geo.standoffMeters = bestGeo.standoffMeters;
  geo.speakers = bestGeo.speakers;
  geo.spacingMeters = bestGeo.spacingMeters;
  if (bestGeo.trafficLevel !== undefined) geo.trafficLevel = bestGeo.trafficLevel; // the saved knob lives too
  for (const c of el('traffic').children) {
    const cb = c as HTMLButtonElement;
    cb.classList.toggle('active', Number(cb.dataset['level'] ?? NaN) === geo.trafficLevel);
  }
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
  const cfg: ScenarioConfig = geometryToScenarioConfig(geo, { seed: SYNTH_SEED, sampleCount: 160000 });
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
  el('v-geo').textContent = `sensor from road ${geo.towerMeters.toFixed(0)} m · zone from road ${geo.zoneMeters.toFixed(0)} m · standoff ${geo.standoffMeters.toFixed(1)} m · ${geo.speakers} unit${geo.speakers === 1 ? '' : 's'} @ ${geo.spacingMeters ?? 4} m`;
  if (audio) void rebuildAudioLoops(result);
  draw();

  // session-best tracker, per traffic source (skips infeasible-throw configs, which never reach here)
  sessionBest.consider(result.reductionDb, geo, sourceKey);
  el('v-best').textContent = sessionBest.current(sourceKey)?.db.toFixed(1) + ' dB';
  el('btn-best').hidden = sessionBest.current(sourceKey) === null;
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

// Meta muse-image-1.0 backdrop (one generated asset; road cropped out in fieldViz — see TEXTURE_ROAD_END)
// + photo-derived accents state (set after a successful photo segmentation; cleared on reset/URL change)
const mapTexture = new Image();
mapTexture.src = 'map-texture.webp';
mapTexture.onload = () => draw();
mapTexture.onerror = () => draw(); // texture missing → plain dark map, physics unchanged
let photoDerived: PhotoDerived | null = null;

function draw(highlight: Marker | null = null): void {
  const canvas = el<HTMLCanvasElement>('field');
  if (!canvas) return;
  renderField(canvas, geo, { highlight, freqHz, texture: mapTexture, photoDerived });
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

// reset: full scratch — default geometry/traffic/view; the guided tour highlight cleared
el('btn-reset').addEventListener('click', () => {
  if (audio) {
    audio.ctx.close();
    audio = null;
  }
  el('transport').hidden = true;
  el('readout').hidden = true;
  geo.towerMeters = 20;
  geo.zoneMeters = 30;
  geo.standoffMeters = 5;
  geo.speakers = 1;
  geo.spacingMeters = undefined;
  geo.trafficLevel = 1;
  sourceKey = 'synthetic';
  freqHz = 100;
  sourceSignal = null;
  el('traffic-note').textContent = 'Source: the seeded synthetic traffic (the test bed — fully reproducible). Cancelled stream is at Normal level.';
  for (const c of el('scenarios').children) c.classList.remove('active');
  document.getElementById('btn-synthetic')?.classList.add('active');
  for (const c of el('traffic').children) {
    const cb = c as HTMLButtonElement;
    cb.classList.toggle('active', Number(cb.dataset['level'] ?? NaN) === 1);
  }
  for (const c of el('waves').children) c.classList.toggle('active', (c as HTMLButtonElement).textContent === '100 Hz');
  document.querySelectorAll('.tour-on').forEach((n) => n.classList.remove('tour-on'));
  sessionBest.reset();
  // pending agent state dies with the scratch — a stale After-tuning button must not replay old results
  agentReview = null;
  postAgentResult = null;
  el('review').hidden = true;
  el('agent-ab').hidden = true;
  agentConsole.setStatus('idle', false);
  photoDerived = null;
  tourHost.innerHTML = ''; // close any open tour card
  rerun(); // fresh readouts

});

// traffic source presets: synthetic + real recordings (real sources superseded the seeded A/B/C mixes)
const REAL_SOURCES: { file: string; label: string; note: string }[] = [
  { file: 'traffic-city-highway', label: 'City highway', note: 'CC0 · sotiris_laskaris (Freesound #563698)' },
  { file: 'traffic-motorway-m6', label: 'Motorway M6', note: 'CC0 · JW_audio (Freesound #826246)' },
  { file: 'traffic-us-hwy64-wet', label: 'US highway (wet)', note: 'CC0 · reg7783 (Freesound #632640)' },
];
const recordingCache = new Map<string, Float32Array>();

async function decodeTo16kSignal(ab: ArrayBuffer): Promise<Float32Array> {
  const probe = new AudioContext();
  const decoded = await probe.decodeAudioData(ab);
  void probe.close();
  const off = new OfflineAudioContext(1, decoded.length, 16000);
  const s = off.createBufferSource();
  s.buffer = decoded;
  s.connect(off.destination);
  s.start();
  const rendered = await off.startRendering();
  return rendered.getChannelData(0).slice();
}

async function loadRecording(file: string): Promise<Float32Array> {
  const hit = recordingCache.get(file);
  if (hit) return hit;
  const res = await fetch(`/audio/${file}.wav`);
  const sig = await decodeTo16kSignal(await res.arrayBuffer());
  recordingCache.set(file, sig);
  return sig;
}
const btnSynthetic = document.createElement('button');
btnSynthetic.id = 'btn-synthetic';
btnSynthetic.textContent = 'Synthetic traffic';
btnSynthetic.classList.add('active');
btnSynthetic.title = 'The seeded synthetic source (the test bed)';
btnSynthetic.addEventListener('click', () => {
  sourceSignal = null;
  sourceKey = 'synthetic';
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
      sourceKey = rs.file;
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

// your site's baseline: upload the location's own recorded traffic — the whole pipeline
// (field, agent, per-source session best) runs on it like any other source
const uploadInput = document.createElement('input');
uploadInput.type = 'file';
uploadInput.accept = 'audio/*,wav,m4a,mp3';
uploadInput.hidden = true;
const btnUpload = document.createElement('button');
btnUpload.id = 'btn-site-baseline';
btnUpload.textContent = 'Your baseline…';
btnUpload.title = "Upload a recording of this location's traffic — the quiet zone, measurements and the AI assistant all run on your own baseline";
btnUpload.addEventListener('click', () => uploadInput.click());
uploadInput.addEventListener('change', async () => {
  const f = uploadInput.files?.[0];
  if (!f) return;
  btnUpload.disabled = true;
  btnUpload.classList.remove('failed');
  try {
    const sig = await decodeTo16kSignal(await f.arrayBuffer());
    const key = `site:${f.name}`;
    recordingCache.set(key, sig); // same cache as the presets — re-selecting is instant
    sourceSignal = sig;
    sourceKey = key;
    el('traffic-note').textContent = `Source: your site's baseline — ${f.name} (the location's own collected traffic).`;
    for (const c of el('scenarios').children) c.classList.remove('active');
    btnUpload.classList.add('active');
    rerun();
  } catch {
    btnUpload.classList.add('failed');
    el('traffic-note').textContent = `Could not decode ${f.name} — try a .wav, .m4a or .mp3 file.`;
  } finally {
    btnUpload.disabled = false;
    uploadInput.value = ''; // re-selecting the same file fires change again
  }
});
el('scenarios').appendChild(uploadInput);
el('scenarios').appendChild(btnUpload);

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
for (const n of [1, 2, 3, 4, 5]) {
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
const EXAMPLE_PHOTO = 'https://cdn.pixabay.com/photo/2019/08/23/22/40/city-4426650_1280.jpg'; // Pixabay Content License — São Paulo viaduct, daytime traffic
// photo preview: the uploaded/pasted photo shows above the placement box, suitably sized
const previewEl = el<HTMLImageElement>('photo-preview');
previewEl.addEventListener('error', () => { previewEl.hidden = true; });
function syncPhotoPreview(): void {
  const url = el<HTMLInputElement>('photo-url').value.trim();
  if (!url) {
    previewEl.hidden = true;
    previewEl.src = '';
    photoDerived = null;
    draw(); // map back to the plain backdrop — the photo's accents leave with its input
    return;
  }
  if (previewEl.src !== url) previewEl.src = url;
  previewEl.hidden = false; // broken URL hides itself via the error listener
}
el('photo-url').addEventListener('input', syncPhotoPreview);
el('btn-example').addEventListener('click', () => {
  el<HTMLInputElement>('photo-url').value = EXAMPLE_PHOTO;
  syncPhotoPreview();
});
let proposal: PlacementProposal | null = null;
// SAM's server-side fetcher rejects several popular hosts (pixabay, unsplash…) — but it accepts
// inline data: URIs. Convert the image in the browser when CORS allows; fall back to the raw URL.
async function samImageUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return url;
    const blob = await res.blob();
    if (blob.size > 4_000_000) return url; // too big to inline — let the server fetch the URL itself
    return await new Promise<string>((resolve) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => resolve(url);
      fr.readAsDataURL(blob);
    });
  } catch {
    return url; // CORS-blocked → the server fetches the URL itself (works for Wikimedia etc.)
  }
}
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
    const imageUrl = await samImageUrl(url); // inline when possible — no host restrictions
    const seg = async (prompt: string): Promise<string> => {
      const r = await fetch('/api/sam', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imageUrl, prompt }) });
      const j = (await r.json()) as { ok: boolean; output?: string; reason?: string };
      if (!j.ok) throw new Error(j.reason ?? 'segmentation failed');
      return j.output ?? '';
    };
    // two passes in parallel; the zone pass falls back to 'sidewalk' — SAM reliably segments
    // sidewalks in street scenes where 'open ground' comes back empty (city photos never had trees-to-protect open ground)
    const [roadRaw, zoneRaw] = await Promise.all([seg('road'), seg('open ground')]);
    const road = parseSamBoxes(roadRaw);
    let zone = parseSamBoxes(zoneRaw);
    if (zone.length === 0) zone = parseSamBoxes(await seg('sidewalk'));
    // SAM boxes are pixel-space of the original photo — real dimensions from the preview
    // (a 1×1 fallback keeps the fraction bounded; the previous 1,1 call made every proposal clamp)
    const frameW = previewEl.naturalWidth || 1200;
    const frameH = previewEl.naturalHeight || 800;
    proposal = interpretPlacement({ road, zone }, frameW, frameH);
    // the map gets the photo-derived accents: where the protected areas sit along the corridor (stylized)
    photoDerived = road.length > 0 ? { boxes: (zone.length > 0 ? zone : road).map((b) => ({ x1: b.x1, y1: b.y1, x2: b.x2, y2: b.y2 })), frameW, frameH } : null;
    draw();
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

// goal chips: the assistant's objective — deepest dB (default) or widest quiet band
function updateGoalChips(): void {
  el('goal-depth').classList.toggle('active', agentGoal === 'depth');
  el('goal-area').classList.toggle('active', agentGoal === 'area');
}
el('goal-depth').addEventListener('click', () => { agentGoal = 'depth'; updateGoalChips(); });
el('goal-area').addEventListener('click', () => { agentGoal = 'area'; updateGoalChips(); });

// the agent's memory line: count + clear (persists in this browser across refreshes; never auto-wiped)
function updateMemoryLine(): void {
  el('agent-memory-line').hidden = agentMemory.count() === 0;
  el('agent-memory-count').textContent = String(agentMemory.count());
  el('agent-memory-unit').textContent = agentMemory.count() === 1 ? 'lesson' : 'lessons';
}
el('btn-memory-clear').addEventListener('click', () => {
  agentMemory.clear();
  updateMemoryLine();
  agentConsole.log({ state: '—', decision: 'cleared the agent memory', applied: 'no lessons on file' });
});
if (agentMemory.count() > 0) updateMemoryLine(); // lessons from earlier this session

el('btn-agent').addEventListener('click', async () => {
  const btn = el<HTMLButtonElement>('btn-agent');
  btn.disabled = true;
  // ticker right here under the button — the first thing the eye finds after clicking
  let sec = 0;
  const tickEl = el<HTMLParagraphElement>('agent-status');
  tickEl.textContent = 'AI is doing the evaluation… 0 s';
  const t = setInterval(() => {
    sec += 1;
    tickEl.textContent = `AI is doing the evaluation… ${sec} s`;
  }, 1000);
  try {
    const r: ScenarioResult | null = result;
    if (!r) return;
    const review = await proposeTurn(proxyBrain, geo, r, agentConsole, {
      goal: agentGoal,
      memory: agentMemory.precedents(),
      bandFreqHz: freqHz,
    });
    clearInterval(t);
    if (review.decision.kind === 'unavailable') {
      tickEl.textContent = 'No usable suggestion this time — the model explained why (see the trail below).';
      el('review').hidden = true;
      return;
    }
    tickEl.textContent = 'Suggestion ready — review it just below (accept one by one, all, or discard).';
    agentReview = { decision: review.decision, preGeo: { ...geo }, preResult: r };
    renderReview(review.decision);
  } catch (e) {
    clearInterval(t);
    agentConsole.stopThinking('idle');
    const reason = e instanceof Error ? e.message : String(e);
    tickEl.textContent = 'The assistant call failed (network or server) — try again.';
    agentConsole.log({ state: '—', decision: 'assistant unreachable', applied: reason.slice(0, 120) });
  } finally {
    clearInterval(t);
    btn.disabled = false;
  }
});

const PARAM_LABELS: [string, string][] = [
  ['towerMeters', 'Sensor tower distance from road'],
  ['zoneMeters', 'Quiet-zone distance from road'],
  ['standoffMeters', 'Cancel-array standoff — the gap between the array and the quiet zone'],
  ['speakers', 'Array nodes (number of noise-cancellation field units in a line along the road)'],
  ['spacingMeters', 'Node spacing — how far apart the field units sit along the road'],
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
      innerHTML: `<input type="checkbox" checked data-p="mu"> <span>Adaptation rate — how fast the field learns the noise: → <b class="new">${fmt(decision.mu)}</b></span>`,
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
  el('btn-post-agent').textContent = `After tuning (${next.reductionDb.toFixed(1)} dB)`;
  if (agentReview) {
    el('btn-pre-agent').textContent = `Before tuning (${agentReview.preResult.reductionDb.toFixed(1)} dB)`;
    // honesty moment: if the measured result is worse on the chosen goal's metric, say so and offer a revert
    const nextBand = quietBandMeters(next.geometry, freqHz);
    const preBand = quietBandMeters(agentReview.preGeo, freqHz);
    const metric = agentGoal === 'area' ? 'band' : 'dB';
    const before = agentGoal === 'area' ? preBand : agentReview.preResult.reductionDb;
    const after = agentGoal === 'area' ? nextBand : next.reductionDb;
    const worse = after < before - 0.1;
    el('btn-post-agent').textContent = `After tuning (${next.reductionDb.toFixed(1)} dB · band ${nextBand.toFixed(1)} m)`;
    el('btn-post-agent').classList.toggle('worse', worse);
    el('btn-revert-agent').hidden = !worse;
    if (worse) {
      agentConsole.log({
        state: `measured after the change: ${next.reductionDb.toFixed(1)} dB · band ${nextBand.toFixed(1)} m`,
        decision: `measured WORSE on the goal's metric (${metric}) — the model's idea did not help this setup`,
        applied: 'revert available; nothing is hidden',
      });
    }
    // the agent files every accepted, re-measured turn — its memory for future suggestions
    agentMemory.record({
      goal: agentGoal,
      source: sourceKey,
      geometry: { ...next.geometry },
      mu: agentReview.decision.mu,
      measuredDb: next.reductionDb,
      bandMeters: nextBand,
      note: agentReview.decision.note,
    });
    updateMemoryLine();
    agentConsole.log({
      state: `goal: ${agentGoal} · ${next.reductionDb.toFixed(1)} dB · band ${nextBand.toFixed(1)} m`,
      decision: 'filed to memory — future suggestions get this outcome as a precedent',
      applied: `${agentMemory.count()} lesson${agentMemory.count() === 1 ? '' : 's'} on file`,
    });
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
  const checked = checkedParams();
  if (checked.length === 0) {
    agentConsole.log({ state: `${result.reductionDb.toFixed(1)} dB`, decision: 'nothing accepted', applied: 'nothing applied — the review stays open' });
    return;
  }
  const only = checked.filter((p) => p !== 'mu') as ('towerMeters' | 'zoneMeters' | 'standoffMeters' | 'speakers' | 'spacingMeters')[];
  // μ unchecked → strip it from the applied decision (it silently applied before)
  const decision = checked.includes('mu') ? agentReview.decision : { ...agentReview.decision, mu: undefined };
  try {
    const next = only.length
      ? await applyDecision(geo, result, decision, agentConsole, { only, sourceSignal: sourceSignal ?? undefined, bandFreqHz: freqHz })
      : await applyDecision(geo, result, decision, agentConsole, { only: ['mu'] as never, sourceSignal: sourceSignal ?? undefined, bandFreqHz: freqHz });
    afterAgent(next);
  } catch (e) {
    // e.g. feasibility throw deep in the sim — never an unhandled rejection mid-demo (audit P1 #7)
    agentConsole.log({ state: `${result.reductionDb.toFixed(1)} dB`, decision: 'application failed — nothing changed', applied: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
  }
});

el('btn-apply-all').addEventListener('click', async () => {
  if (!agentReview || !result) return;
  try {
    const next = await applyDecision(geo, result, agentReview.decision, agentConsole, { sourceSignal: sourceSignal ?? undefined, bandFreqHz: freqHz });
    afterAgent(next);
  } catch (e) {
    agentConsole.log({ state: `${result.reductionDb.toFixed(1)} dB`, decision: 'application failed — nothing changed', applied: (e instanceof Error ? e.message : String(e)).slice(0, 120) });
  }
});

el('btn-discard').addEventListener('click', () => {
  agentConsole.log({ state: agentReview ? `${agentReview.preResult.reductionDb.toFixed(1)} dB` : '—', decision: 'user discarded the proposal', applied: 'geometry unchanged' });
  agentReview = null;
  el('review').hidden = true;
  el('agent-ab').hidden = true;
});

el('btn-pre-agent').addEventListener('click', () => toggleAgentStream('pre'));
el('btn-post-agent').addEventListener('click', () => toggleAgentStream('post'));
el('btn-revert-agent').addEventListener('click', () => {
  if (!agentReview) return;
  geo.towerMeters = agentReview.preGeo.towerMeters;
  geo.zoneMeters = agentReview.preGeo.zoneMeters;
  geo.standoffMeters = agentReview.preGeo.standoffMeters;
  geo.speakers = agentReview.preGeo.speakers;
  geo.spacingMeters = agentReview.preGeo.spacingMeters;
  rerun();
  postAgentResult = null;
  el('agent-ab').hidden = true;
  agentConsole.log({ state: 'reverted', decision: 'user reverted the assistant’s change', applied: `${setupLabel(geo)} — back to ${agentReview.preResult.reductionDb.toFixed(1)} dB level tuning` });
  agentReview = null;
});

// drag interaction on the field (offsets computed from clientX/Y — same value as offsetX for real
// pointers, but synthetic driver events carry client coords only)
const canvas = el<HTMLCanvasElement>('field');
const canvasOffset = (ev: PointerEvent): { x: number; y: number } => {
  const b = canvas.getBoundingClientRect();
  return { x: ev.clientX - b.left, y: ev.clientY - b.top };
};
canvas.addEventListener('pointerdown', (ev) => {
  const o = canvasOffset(ev);
  dragging = hitTest(canvas, geo, o.x, o.y);
  if (dragging) {
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      // synthetic driver events have no active pointer id — capture is a real-pointer convenience
    }
    draw(dragging);
  }
});
canvas.addEventListener('pointermove', (ev) => {
  if (!dragging) return;
  const o = canvasOffset(ev);
  const m = Math.max(0.5, pxToMeters(o.x, canvas.clientWidth));
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