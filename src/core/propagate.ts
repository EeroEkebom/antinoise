/** Propagation path: integer-sample delay + linear interpolation for the fractional part, plus simple geometric attenuation. */
export function propagate(
  signal: Float32Array,
  distanceMeters: number,
  sampleRate: number,
  speedOfSound: number = 343,
): { out: Float32Array; samplesDelayed: number; gain: number } {
  const gain = 10 / (10 + distanceMeters);
  const delaySamples = (distanceMeters / speedOfSound) * sampleRate;
  const whole = Math.floor(delaySamples);
  const frac = delaySamples - whole;
  const out = new Float32Array(signal.length + whole + 1);
  for (let i = 0; i < signal.length; i++) {
    out[i + whole] += signal[i] * gain * (1 - frac);
    if (frac > 0) out[i + whole + 1] += signal[i] * gain * frac;
  }
  return { out, samplesDelayed: whole, gain };
}