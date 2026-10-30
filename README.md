# Antinoise

Feedforward noise cancellation for road traffic — not in your earbuds, but across an open roadside zone.
Sensor towers hear the rumble first; an optical-fiber relay (analysis faster than sound) hands the noise
profile to a downstream controller before the sound arrives, turning geometry into **anticipation time**.

Built for the **Meta Global AI Developer Hackathon** (Oct 27 – Nov 4, 2026) — 100% of this repository
was built during the building period (first commit is the scaffold below).

## What's in the sim

- **Physics core** (`src/core/`): seeded traffic-rumble source (60–160 Hz harmonic stacks + low-passed
  broadband), propagation paths (delay + attenuation), an NLMS-based **FXLMS adaptive controller** with
  divergence guards, and the two-tower fiber scenario with the emission scheduler.
- **Honest physics:** lead time = distance ÷ 343 m/s; the quiet zone is **wavelength-capped** — deep rumble
  cancels across a region, short waves only in a narrow spot. The page says so, not just the README.
- **The commissioning agent** (`src/brain/`): Meta's open-weights **Muse Spark Open**
  (`meta-models/muse-spark-open-1026`) on Baseten reads the live field state and proposes physical
  parameter changes (tower distance, array nodes, standoff, adaptation rate) — every proposal is validated
  against feasibility physics before it is applied and re-measured on screen. **SAM 3.1** (Meta Model API)
  proposes placement from a street photo.
- **Audio + field UI** (`src/audio/`, `src/ui/`): audible A/B (traffic vs. quiet zone), interactive field map
  with drag markers, per-frequency wave view with cross-section, live dB readouts.

## Security posture

API keys are read from environment variables or files **outside this repository** by the dev-server proxy
only (`/api/brain`, `/api/sam`) — keys never ship to client code. All model traffic uses Meta's supported
API surfaces (Meta Model API docs + Baseten's OpenAI-compatible endpoint); the dev.meta.ai dashboard is
never automated.

## Run

```bash
npm install
npm test          # vitest — 56 tests, all green at freeze
npm run numbers   # headline physics numbers (reduction dB, fiber-lead advantage)
npm run dev       # http://localhost:5199 (Safari-first)
```

## Honest limitations

- Simulation, not hardware: single quiet-zone point, line-source road noise, 2D world.
- Low-frequency scope (< ~500 Hz) is a physical necessity, not a shortcut.
- The zone's depth depends on the wavelength — the UI shows where cancellation genuinely fails.

Licence: MIT (see LICENSE).