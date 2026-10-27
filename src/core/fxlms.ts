/** FXLMS feedforward controller: LMS adaptive filter whose update gradient is filtered by the estimated secondary path.
 * NLMS step: mu is clamped to ≤1 in the normalized domain, stable for any caller-supplied mu; per-tap and
 * output clamps add the hard divergence guards the plan requires. */
export function createFxLms(opts: { taps: number; mu: number; secondaryPath: number[] }): {
  process(referenceSample: number): number;
  adapt(residual: number, delayedOutput?: number): void;
} {
  const weights = new Float64Array(opts.taps);
  const spEstimate = Float64Array.from(opts.secondaryPath);
  const spLen = spEstimate.length;
  // The gradient for tap i convolves the estimate over reference history back to sample n-i-spLen;
  // the buffer holds taps + spLen so no tap's gradient silently loses history.
  const inputBuf = new Float64Array(opts.taps + spLen); // reference samples; [len-1] = newest
  const filtBuf = new Float64Array(opts.taps); // filtered reference (secondary path ⊛ input), [len-1] = newest
  const xFilt = new Float64Array(opts.taps); // per-call scratch
  const MAX_WEIGHT_STEP = 0.5; // per-tap change clamp (divergence guard)
  const MAX_OUTPUT = 2; // output clamp (divergence guard)
  // Estimated secondary-path support depth (last nonzero tap index + 1) — drives the step cap:
  // a delayed plant makes high normalized steps unstable, so mu_eff <= 1/(2*(D_hat+1)).
  let delayDepth = 1;
  for (let j = spEstimate.length - 1; j >= 0; j--) {
    if (spEstimate[j] !== 0) {
      delayDepth = j + 1;
      break;
    }
  }
  const muCap = 1 / (2 * (delayDepth + 1));

  // saturation-freeze state
  const EMA_OUT_ALPHA = 0.01; // ~100-sample |output| tracker
  const SAT_HI = 0.7; // sustained |y| above 70% of clamp = mis-adaptation
  const SAT_LO = 0.1;
  const SAT_RUN = 512; // sustained-sample requirement
  const MAX_FREEZE_STRIKES = 2;
  const FREEZE_LEAK = 0.99;
  let emaOuty = 0;
  let satRun = 0;
  let frozen = false;
  let freezeStrikes = 0;
  let latched = false;

  let lastOutput = 0; // most recent clamped controller output (freeze-detector input)

  return {
    process(referenceSample: number): number {
      // a single non-finite reference sample would saturate the gradient (NaN clamps pass through) — treat as silence
      if (!Number.isFinite(referenceSample)) referenceSample = 0;
      for (let i = 0; i < inputBuf.length - 1; i++) inputBuf[i] = inputBuf[i + 1];
      inputBuf[inputBuf.length - 1] = referenceSample;

      // incremental filtered reference: F(k) = Σ_j spEstimate[j] · x(k−j), maintained per sample in O(spLen)
      let f = 0;
      for (let j = 0; j < spLen; j++) {
        const idx = inputBuf.length - 1 - j;
        if (idx >= 0) f += spEstimate[j] * inputBuf[idx];
      }
      for (let i = 0; i < filtBuf.length - 1; i++) filtBuf[i] = filtBuf[i + 1];
      filtBuf[filtBuf.length - 1] = f;

      let y = 0;
      for (let i = 0; i < opts.taps; i++) y += weights[i] * inputBuf[inputBuf.length - 1 - i];
      lastOutput = Math.max(-MAX_OUTPUT, Math.min(MAX_OUTPUT, y));
      return lastOutput;
    },

    adapt(residual: number, delayedOutput?: number): void {
      void delayedOutput; // textbook FXLMS needs only the reference history
      if (!Number.isFinite(residual)) return;
      // --- saturation freeze (wrong-ŝ guard): a mis-estimated secondary path drives the loop
      // into a saturated limit cycle that AMPLIFIES the zone. Legit loud pass-bys never push the
      // anti-noise near its clamp, so sustained near-clamp output = mis-adaptation:
      // freeze + weight decay; a second sustained saturation latch the controller into stand-down.
      if (latched) return;
      const ao = Math.abs(lastOutput);
      emaOuty += EMA_OUT_ALPHA * (ao - emaOuty);
      if (!frozen) {
        if (emaOuty > SAT_HI * MAX_OUTPUT) {
          if (++satRun >= SAT_RUN) {
            frozen = true;
            satRun = 0;
            freezeStrikes++;
            if (freezeStrikes >= MAX_FREEZE_STRIKES) {
              latched = true;
              weights.fill(0); // stand down: open loop is better than amplification
              return;
            }
          }
        } else {
          satRun = 0;
        }
      } else {
        if (emaOuty < SAT_LO * MAX_OUTPUT) {
          frozen = false;
        } else {
          for (let i = 0; i < opts.taps; i++) weights[i] *= FREEZE_LEAK; // decay, skip gradient
          return;
        }
      }
      let normSq = 0;
      // gradient for tap i = filtered reference at lag i
      for (let i = 0; i < opts.taps; i++) {
        xFilt[i] = filtBuf[filtBuf.length - 1 - i];
        normSq += xFilt[i] * xFilt[i];
      }
      if (!Number.isFinite(normSq)) return;
      const muN = opts.mu > 0 ? Math.min(opts.mu, 1, muCap) : 0; // normalized + delay-aware clamp
      const denom = normSq > 1e-12 ? normSq : 1e-12;
      for (let i = 0; i < opts.taps; i++) {
        const delta = (muN * residual * xFilt[i]) / denom;
        weights[i] += Math.max(-MAX_WEIGHT_STEP, Math.min(MAX_WEIGHT_STEP, delta));
      }
    },
  };
}