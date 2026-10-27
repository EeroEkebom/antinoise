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

  return {
    process(referenceSample: number): number {
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
      return Math.max(-MAX_OUTPUT, Math.min(MAX_OUTPUT, y));
    },

    adapt(residual: number, delayedOutput?: number): void {
      void delayedOutput; // textbook FXLMS needs only the reference history
      if (!Number.isFinite(residual)) return;
      let normSq = 0;
      // gradient for tap i = filtered reference at lag i
      for (let i = 0; i < opts.taps; i++) {
        xFilt[i] = filtBuf[filtBuf.length - 1 - i];
        normSq += xFilt[i] * xFilt[i];
      }
      const muN = opts.mu > 0 ? Math.min(opts.mu, 1, muCap) : 0; // normalized + delay-aware clamp
      const denom = normSq > 1e-12 ? normSq : 1e-12;
      for (let i = 0; i < opts.taps; i++) {
        const delta = (muN * residual * xFilt[i]) / denom;
        weights[i] += Math.max(-MAX_WEIGHT_STEP, Math.min(MAX_WEIGHT_STEP, delta));
      }
    },
  };
}