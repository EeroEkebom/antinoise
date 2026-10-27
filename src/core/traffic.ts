import type { Rng } from './rng.js';

/** One pass-by vehicle: a low harmonic stack under an approach/recede envelope. */
type Vehicle = {
  startSample: number; // first sample in which the vehicle is audible
  durationSamples: number;
  baseFreq: number; // Hz, 60–160
  harmonicAmps: number[]; // amps for harmonics 1..5, harmonic 1 amp = amps[0]
  rumbleAmp: number; // broadband component scale
  closestDistanceFraction: number; // shapes envelope floor (0..1)
  peakAmp: number; // envelope peak (perceptual loudness proxy)
};

/** Exponential-ish pass-by spacing draw, in seconds. */
function nextGapSeconds(rng: Rng): number {
  return 0.8 + 1.6 * -Math.log(1 - rng.nextFloat());
}

function spawnVehicle(rng: Rng, startSample: number, sampleRate: number): Vehicle {
  const baseFreq = 60 + rng.nextFloat() * 100; // 60–160 Hz
  const harmonicAmps: number[] = [];
  let h0 = 0.4 + rng.nextFloat() * 0.3;
  for (let k = 1; k <= 5; k++) {
    harmonicAmps.push(h0);
    h0 *= 0.5 + 0.2 * rng.nextFloat();
  }
  return {
    startSample,
    durationSamples: Math.round((2 + rng.nextFloat() * 4) * sampleRate),
    baseFreq,
    harmonicAmps,
    rumbleAmp: 0.2 + rng.nextFloat() * 0.2,
    closestDistanceFraction: 0.15 + rng.nextFloat() * 0.35,
    peakAmp: 0.5 + rng.nextFloat() * 0.3,
  };
}

/** Seeded traffic rumble: superposition of 60–160 Hz pass-by harmonic stacks + low-passed broadband rumble. */
export function createTrafficSource(rng: Rng, sampleRate: number): { nextSample(): number } {
  const vehicles: Vehicle[] = [];
  let nextEventAt = 0;
  let sample = 0;
  // Pre-warm: one vehicle already mid-pass at sample 0, so any 1 s window starts with content.
  vehicles.push({ ...spawnVehicle(rng, -Math.round(sampleRate * 0.5), sampleRate) });
  let nextEventSamples = nextGapSeconds(rng) * sampleRate;

  // One-pole low-pass state for the broadband rumble.
  let lpState = 0;
  const lpAlpha = 1 - Math.exp((-2 * Math.PI * 350) / sampleRate); // ~350 Hz cutoff

  function envelope(v: Vehicle, tSamples: number): number {
    const u = tSamples / v.durationSamples; // 0..1 through the pass
    // Symmetric approach/recede: peak at closest approach, floor at the distance fraction.
    const bell = Math.exp(-Math.pow((u - 0.5) / 0.28, 2));
    return v.peakAmp * (v.closestDistanceFraction + (1 - v.closestDistanceFraction) * bell);
  }

  return {
    nextSample(): number {
      if (sample >= nextEventSamples) {
        vehicles.push(spawnVehicle(rng, sample, sampleRate));
        nextEventSamples = sample + nextGapSeconds(rng) * sampleRate;
      }
      let out = 0;
      for (let i = vehicles.length - 1; i >= 0; i--) {
        const v = vehicles[i];
        const t = sample - v.startSample;
        if (t >= v.durationSamples) {
          vehicles.splice(i, 1);
          continue;
        }
        const env = envelope(v, t);
        const phase = (2 * Math.PI * v.baseFreq * t) / sampleRate;
        let har = 0;
        for (let k = 0; k < v.harmonicAmps.length; k++) {
          har += v.harmonicAmps[k] * Math.sin(phase * (k + 1));
        }
        out += v.peakAmp * env * har;
        out += v.peakAmp * v.rumbleAmp * env * lpState;
      }
      lpState += lpAlpha * ((rng.nextFloat() * 2 - 1) - lpState);
      sample++;
      return out;
    },
  };
}