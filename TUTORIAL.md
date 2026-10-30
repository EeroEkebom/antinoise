# Antinoise — Tutorial

The 60-second in-app version: the **"Take the 60-second tour →"** button at the top of the page.
This document is the same walk, in full detail.

## 0 · What you're looking at

A simulation of feedforward (anticipatory) noise cancellation along a road:

```
[ road: traffic noise ] →(d_tower)→ [ sensor tower ]
                                        │ optical fiber (analysis ~instant)
                                        ▼
                              [ controller: FXLMS + emission scheduler ]
                                        │  anti-noise, timed
                                        ▼
                    (d_array→zone)→ [ cancel array ] … [ quiet zone ]
                        ambient sound travels (d_road→zone) and meets the anti-noise there
```

The whole idea: **the fiber relay is faster than sound**, so the analysis reaches the field *before*
the noise does — the geometry buys anticipation time: `lead = (zone − tower − standoff) / 343 m/s`.
At 30 m of head start that's ~88 ms; at 100 m ~290 ms.

## 1 · Hear it (Listen card)

1. Click a traffic mix (A/B/C — same geometry, different random traffic).
2. In the transport, flip between **Traffic noise (no field)** and **With Antinoise field** —
   the toggle is instant and loop-aligned, so you hear the same traffic with and without
   cancellation (~20 dB less). Headphones are recommended: the content is deep rumble
   (60–160 Hz harmonic stacks).
3. Readouts: **Zone reduction** (the headline), **Fiber lead** (ms bought by geometry),
   **Traffic at zone** (loudness falls with distance, independent of the field).

## 2 · Move the field (map card)

- **Drag the sensor tower** — closer to the road = longer lead (the readout updates in ms).
  Try dragging it right onto the road: the clamps stop you — physics forbids it.
- **Drag the quiet zone** — the loudness stat drops as you move away; the cancellation *quality* stays
  (distance-scale-invariance of feedforward). The array follows the zone, keeping its **standoff**.
- **Drag the cancel array** = reshape the standoff (0.5–25 m).
- Feasibility is enforced live: impossible geometries get a warning banner instead of a silent 0 dB.

## 3 · The knobs

- **Array nodes (1–5)** — each node cancels its own band; the shaded union is the honest quiet zone.
- **Node spacing (2/4/6 m)** — how the nodes spread along the road.
- **Wave frequency (63–630 Hz)** — re-render the map at a chosen frequency. Watch the quiet band
  shrink as waves shorten: λ caps the zone. Cross-section strip: orange = ambient wave,
  blue = anti-wave, **teal = what the zone actually hears**.
- **Traffic level** — scales loudness only. Reduction dB does not change: linear feedforward

## 4 · The commissioning agent (Meta's Muse Spark Open — open weights)

1. Click **Consult the commissioning agent →**.
2. The console shows the real reasoning trail: **observed** (dB, lead, geometry, per-frequency depth)
   → **decided** (the model's physics-honest proposal) → **applied** (parameter diff) → then the
   **after** row with the newly measured dB.
3. The agent is validated against feasibility physics before anything applies; if it cannot improve
   honestly, it **stands down** rather than amplifying (watch: wrong estimates are rejected, never applied).

## 5 · Place from a photo (SAM 3.1)

1. Paste a **public street-photo URL**.
2. **Segment & propose placement →** — SAM 3.1 segments the road and open ground; a placement
   proposal is computed from the photo's proportions.
3. Read the note; **Apply proposal** only if it makes sense — you confirm, the field re-runs.

## Try a full session

1. Tour (60 s) → 2. A/B listen → 3. Drag the zone twice and watch loudness vs reduction
→ 4. Consult the agent twice (it usually finds an improvement after the first) →
5. Place from a photo → submit your verdict by dragging one more marker yourself.