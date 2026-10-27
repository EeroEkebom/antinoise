/** Bridge from the 16 kHz simulation buffers to an AudioContext: linear-interp resampler (alignment-preserving)
 * + soft clip limiter so the summed playback can never exceed [-1, 1]. */
export function prepareAudioBuffers(
  out: { open: Float32Array; closed: Float32Array },
  targetSampleRate: number,
): { open: Float32Array; closed: Float32Array } {
  const resample = (src: Float32Array, target: number): Float32Array => {
    // soft clip first (limiter), then resample — keeps the limiter's guarantee through interpolation
    const limited = new Float32Array(src.length);
    for (let i = 0; i < src.length; i++) limited[i] = Math.tanh(src[i]);
    if (target === 16000) return limited;
    const ratio = target / 16000;
    const n = Math.round(src.length * ratio);
    const dst = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const pos = i / ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      if (i0 + 1 < limited.length) dst[i] = limited[i0] * (1 - frac) + limited[i0 + 1] * frac;
      else if (i0 < limited.length) dst[i] = limited[limited.length - 1];
      else dst[i] = 0;
    }
    return dst;
  };
  return { open: resample(out.open, targetSampleRate), closed: resample(out.closed, targetSampleRate) };
}