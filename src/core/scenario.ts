import { CONFIG } from './rng.js';
import { createRng, type Rng } from './rng.js';
import { createTrafficSource } from './traffic.js';
import { propagate } from './propagate.js';
import { createFxLms } from './fxlms.js';

export type ScenarioConfig = {
  seed: number;
  /** Road → sensor tower distance, meters (sets the controller's reference lead). */
  towerSeparationMeters: number;
  /** Road → quiet zone distance, meters. */
  zoneSeparationMeters: number;
  sampleCount: number;
  mu: number;
  /** Model the fiber relay (analysis outruns sound)? false = the "analysis travels as sound" contrast case. Default true. */
  modelFiberLead?: boolean;
  /** Cancel array standoff from the zone, meters (speaker → zone secondary path). Default 5. */
  arrayStandoffMeters?: number;
  taps?: number;
};

export type ScenarioResult = {
  openLoop: Float32Array; // zone noise without control
  closedLoop: Float32Array; // zone residual with control
  reductionDb: number;
};

export function reductionDb(open: Float32Array, closed: Float32Array): number {
  const rms = (x: Float32Array) => {
    let s = 0;
    for (let i = 0; i < x.length; i++) s += x[i] * x[i];
    return Math.sqrt(s / x.length);
  };
  return 20 * Math.log10(rms(open) / rms(closed));
}


/** Two-tower fiber-relayed feedforward ANC scenario, whole-buffer (sample-accurate delays). */
export function runScenario(cfg: ScenarioConfig): ScenarioResult {
  const sr = CONFIG.SIM_SAMPLE_RATE;
  const c = CONFIG.SPEED_OF_SOUND;
  const standoff = cfg.arrayStandoffMeters ?? 5;
  const taps = cfg.taps ?? 64;
  const modelFiberLead = cfg.modelFiberLead ?? true;

  // 1. traffic source
  const rng: Rng = createRng(cfg.seed);
  const src = createTrafficSource(rng, sr);
  const x = new Float32Array(cfg.sampleCount);
  for (let n = 0; n < cfg.sampleCount; n++) x[n] = src.nextSample();

  // 2. reference: road → tower (sound), then fiber to the controller (≈ instant)
  let ref = propagate(x, cfg.towerSeparationMeters, sr).out;
  if (!modelFiberLead) {
    // contrast case: instead of fiber, the analysis also travels as *sound* over the zone distance
    ref = propagate(ref, cfg.zoneSeparationMeters, sr).out;
  }

  // 3. controller drives the cancel array
  const secondary = ((): number[] => {
    const d = Math.round((standoff / c) * sr);
    const g = 10 / (10 + standoff);
    const p = new Array(d).fill(0);
    p[d - 1] = g;
    return p;
  })();
  const ctl = createFxLms({ taps, mu: cfg.mu, secondaryPath: secondary });

  // Emission scheduler: the fiber lead lets the controller emit anti-noise timed to arrive
  // in step with the ambient wavefront (ambient delay = road→zone; minus tower reference delay;
  // minus the speaker→zone standoff). Without the fiber lead the scheduler has no head start.
  const ambient0 = Math.round((cfg.zoneSeparationMeters / c) * sr);
  const tower0 = Math.round((cfg.towerSeparationMeters / c) * sr);
  const standoff0 = Math.round((standoff / c) * sr);
  const preDelay = modelFiberLead ? Math.max(0, ambient0 - tower0 - standoff0) : 0;
  // physical feasibility — silent 0-dB failure modes are errors, not degraded modes (review finding 3)
  if (standoff0 < 1) {
    throw new Error(`array standoff too small: ${standoff} m rounds to ${standoff0} delay samples at ${sr} Hz`);
  }
  const alignment = ambient0 - tower0 - standoff0;
  if (modelFiberLead && alignment < 0) {
    // tower too far from the road = the reference arrives too late; lower the tower for more lead
    const maxTowerMeters = ((ambient0 - standoff0) / sr) * c;
    throw new Error(
      `infeasible lead: tower separation ${cfg.towerSeparationMeters} m leaves no reference head start ` +
        `over the ${(cfg.zoneSeparationMeters).toFixed(1)} m zone; lower tower separation to ≤ ${maxTowerMeters.toFixed(1)} m`,
    );
  }
  const preDelayBuf = new Float32Array(preDelay);
  let preDelayIdx = 0;
  const withPreDelay = (refSample: number): number => {
    if (preDelay === 0) return refSample;
    const out = preDelayBuf[preDelayIdx];
    preDelayBuf[preDelayIdx] = refSample;
    preDelayIdx = (preDelayIdx + 1) % preDelay;
    return out;
  };

  // 4. zone stream + closed loop, computed inline in wall time (source emission 0):
  // zone mic at wall n = ambient (road→zone path) minus anti-noise (speaker emits at n,
  // sound reaches the zone standoff samples later) — all path gains/delays applied by hand.
  const ambientAtZone = propagate(x, cfg.zoneSeparationMeters, sr).out;
  const antiGain = 10 / (10 + standoff);
  const y = new Float32Array(cfg.sampleCount);
  const closedLoop = new Float32Array(cfg.sampleCount);
  for (let n = 0; n < cfg.sampleCount; n++) {
    y[n] = ctl.process(withPreDelay(n < ref.length ? ref[n] : 0));
    const amb = n < ambientAtZone.length ? ambientAtZone[n] : 0;
    const emitted = n - standoff0;
    const anti = emitted >= 0 ? antiGain * y[emitted] : 0;
    closedLoop[n] = amb - anti;
    ctl.adapt(closedLoop[n], y[n]);
  }

  // open loop = zone noise without control
  const openLoop = ambientAtZone.slice(0, cfg.sampleCount);
  // burn-in: discard the adaptation transient from the metric
  const burnIn = sr; // 1 s
  return {
    openLoop: openLoop.subarray(burnIn),
    closedLoop: closedLoop.subarray(burnIn),
    reductionDb: reductionDb(openLoop.subarray(burnIn), closedLoop.subarray(burnIn)),
  };
}
