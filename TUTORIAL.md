# Antinoise — Tutorial

The 60-second in-app version: the **"Take the 60-second tour →"** button at the top of the page.
This document is the same walk, with the full concept explained end to end.

## 0 · The concept, step by step

What you simulate is a noise-cancellation system for a road — built like a chain:

1. **The road** is the noise source: traffic emits low-frequency rumble (60–160 Hz harmonic stacks,
   plus a broadband murmur under it). It travels into the surroundings at **343 m/s**.
2. **The sensor tower** sits close to the road, a chosen distance out. It hears the noise
   *first* — the noise has to pass it before it can reach farther out.
3. **The optical fiber** carries the measured noise profile from the tower to the field — *as data*.
   This is the trick at the heart of the concept: data in fiber travels ~2/3 of light speed, utterly
   outrunning sound. The tower's measurement therefore arrives at the field **before the sound itself
   does**. The *head start comes from geometry*: the sound needs `(zone − tower − standoff) / 343`
   seconds while the fiber needs ~nothing — at 30 m of head start that's ~88 ms of lead.
4. **The cancel array** (one or several noise-cancellation field units on a line along the road)
   receives the pre-arrival noise data through the fiber. Each unit generates the **anti-noise** —
   the same frequencies, the same loudness, but mirrored in phase — and, through the
   **emission scheduler**, emits it at exactly the right time so the anti-noise wavefront
   meets the ambient noise wavefront *at the quiet zone, precisely in step*.
5. **The quiet zone** is where the two wavefronts meet: crest meets trough and both disappear.
   What remains is what you hear with the field ON — near silence where the traffic used to be.
   The zone is physically **wavelength-capped**: deep rumble (long waves) can be cancelled across
   a wide band; short waves (high frequencies) only cancel in a narrow spot — that's why this field
   targets low frequencies by physics, while your headphones (cancelling only at your eardrum)
   can go much higher.

## 1 · Hear it (Listen card)

1. **Traffic mixes A/B/C** are three different random traffic patterns on the same road — like
   different times of day (different vehicles, different pass-by timings, different loudness moments).
   The engineering is identical; only the "day on the road" differs.
2. Flip between **Traffic noise (no field)** and **With Antinoise field**: it is the *same traffic,
   at the same moment* — the only difference is what the quiet zone hears. With the field,
   the anti-noise cancels the rumble (~20 dB less). Headphones recommended: the content is deep rumble.
3. Readouts:
   - **Zone reduction** — the headline number (how much quieter the zone is with the field).
   - **Fiber lead** — the milliseconds of pre-arrival information the geometry bought.
   - **Traffic at zone** — how much the traffic has already faded with distance *before* any field:
     loudness falls as you move the zone away; this is separate from cancellation.
   - **Geometry** — the current placement.

## 2 · Move the field (map card)

- **Drag the sensor tower** — closer to road = smaller lead; the readout updates in ms. It can never
  sit in the noise it listens to (min 8 m), never beyond the array or the zone.
- **Drag the quiet zone** — the *loudness* stat drops as it moves away from the road; the reduction
  quality stays (that's distance-scale-invariance of linear feedforward physics). The array follows
  the zone, keeping its **standoff** (by design — they travel as a pair).
- **Drag the cancel array** — reshape the standoff (0.5–25 m). It stays strictly between the sensor
  and the zone: the chain only works in road → sensor → (fiber) → array → zone order.
- Placement is clamped live — impossible geometries get a banner instead of a silent zero.
- The dashed map notes: view frequency, λ (wavelength), quiet-band depth, lead.

## 3 · The knobs

- **Array nodes (1–5)** — each node on the line covers its own band of road; the **shaded union**
  is the zone. More nodes = wider zone. Nodes are directive: each aims at its band, so they don't
  corrupt each other's work.
- **Node spacing (2/4/6 m)** — how far the nodes sit from each other along the road.
- **Wave frequency (63/100/250/630 Hz)** — re-renders the map at a single frequency (a frozen
  wavefront view). Watch the shaded bands shrink as frequency rises: that's the wavelength cap,
  live. The **cross-section strip** shows, along the corridor line: orange = the ambient traffic
  wave, blue = the anti-wave the array emits, **teal = their sum — what the zone actually hears**.
- **Traffic level (Light/Normal/Heavy)** — changes loudness only;
  **cancellation quality is independent of loudness** (linear feedforward physics: halve the
  traffic, the anti-noise halves with it). This is also why one tuning works for quiet nights
  *and* rush hour alike.

## 4 · The commissioning agent (Meta's Muse Spark Open — open weights)

Think of the agent as the **commissioning engineer who tunes the system on your behalf**:

1. Click **Consult the commissioning agent →**.
2. It looks at the **current situation**: the zone reduction (dB), the fiber lead (ms), the whole
   geometry, and how deep the cancellation is at each frequency (63 Hz … 630 Hz).
3. It **weighs what is physically possible** — the wavelength cap, the lead needed for the array's
   timing to stay causal — and proposes concrete design changes (tower distance, node count,
   spacing, standoff, adaptation rate).
4. The proposal is **validated against feasibility physics** before anything applies; then the field
   **re-measures**: the console shows the whole trail as *observed → decided → applied* →
   *after: X dB* — receipts, not claims.
5. If it concludes that no change would help within the physics, it **changes nothing** — a designed
   safety behavior: the agent never risks making the noise louder. (You can see this on impossible
   setups: it declines rather than "cancels".)

## 5 · Place from a photo (SAM 3.1)

A worked example:

1. Click **Use example photo** (a street photo with the road along the bottom, from Wikimedia Commons).
2. **Segment & propose placement →** — SAM 3.1 segments the image twice (once for "road",
   once for "open ground") and returns the pixel boxes; the placement engine converts the
   photo's proportions to meters.
3. A proposal appears — e.g. *"from the photo (road at the bottom): zone ≈ 35 m out, 3 array
   nodes — confirm before applying"* — and the agent console logs it.
4. **Apply proposal** re-runs the field with that placement; the map, readouts and audio update.

You can also paste any public street-photo URL of your own — the proposal is derived from
*that* photo's proportions. You always confirm before applying.

## Try a full session

1. Take the tour (60 s) → 2. A/B listen → 3. Drag the zone: feel loudness vs. reduction
→ 4. Change frequency and watch the zone shrink → 5. Consult the agent twice
→ 6. Place from the example photo → 7. Drag one more marker yourself — you are now the
commissioning engineer.