/** In-app 60-second tour: a dismissible card that walks the page, section by section. */

export type TourFocus = string; // element id

export type TourStep = { target: TourFocus; title: string; body: string };

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'listen',
    title: '1 · Hear the physics',
    body: 'Flip between "Traffic noise" and "With Antinoise field". It is the same traffic, at the same moment — the only thing that changes is what the quiet zone hears: with the field, the anti-noise arrives and cancels the rumble (~20 dB quieter). Traffic mixes A/B/C are different random traffic patterns — like different times of day on the same road.',
  },
  {
    target: 'field',
    title: '2 · The field map',
    body: 'Drag the sensor tower (closer to the road = longer fiber lead, shown in ms), the cancel array, and the quiet zone. The shaded bands are where the array can really cancel at the current frequency (within ¾ of a wavelength of each node — outside them the waves no longer line up). Color meaning: blue-green = cancellation side of the wave (quiet), warm orange-red = constructive side (louder); brightness = how strong; where both wavefronts cancel, the color fades to dark.',
  },
  {
    target: 'listen-knobs',
    title: '3 · The knobs',
    body: 'Array nodes widen the quiet zone (each node covers its own band; the shading shows the union). Node spacing spreads the nodes along the road. Wave frequency re-renders the map at 63–630 Hz — watch the zone shrink as wavelength shortens. Traffic level changes loudness only: cancellation quality is independent of loudness (linear physics).',
  },
  {
    target: 'agent-console',
    title: '4 · The commissioning agent (does the tuning for you)',
    body: 'Meta\'s open-weights Muse Spark Open looks at the current situation — loudness, lead time, geometry, how deep the cancellation is at each frequency — weighs what is physically possible, and proposes design changes (tower distance, node count, spacing, standoff, adaptation rate). The field is then re-measured so you see whether it helped: observed → decided → applied, with receipts. If it concludes no change would help within the physics, it changes nothing — rather than risk making the noise louder.',
  },
  {
    target: 'photo',
    title: '5 · Place from a photo',
    body: 'Example: take a street photo where the road runs along the bottom. SAM 3.1 segments the road and the open ground above it; the placement engine converts the photo\'s proportions to meters and proposes — say — a zone ~35 m from the road with 3 array nodes. The note explains its proposal; you confirm with Apply, then the field re-runs with the new geometry. You can also just paste your own photo URL.',
  },
];

export function createTour(
  host: HTMLElement,
  opts: { onFocus?: (id: TourFocus | null) => void } = {},
): { next(): void; back(): void; exit(): void } {
  let i = 0;

  const render = (): void => {
    const { onFocus } = opts;
    onFocus?.(TOUR_STEPS[i].target);
    host.innerHTML = `
      <div class="tour-card">
        <div class="tour-head">
          <strong>${TOUR_STEPS[i].title}</strong>
          <button class="tour-x" aria-label="close">✕</button>
        </div>
        <p>${TOUR_STEPS[i].body}</p>
        <div class="tour-nav">
          <div class="tour-dots">${TOUR_STEPS.map((_, k) => `<span class="${k === i ? 'active' : ''}">${k + 1}</span>`).join('')}</div>
          <div class="tour-btns">
            <button class="tour-back" ${i === 0 ? 'disabled' : ''}>Back</button>
            <button class="tour-next">${i === TOUR_STEPS.length - 1 ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    `;
    host.querySelector<HTMLButtonElement>('.tour-next')!.onclick = () => goto(i + 1);
    host.querySelector<HTMLButtonElement>('.tour-back')!.onclick = () => goto(i - 1);
    host.querySelector<HTMLButtonElement>('.tour-x')!.onclick = exit;
  };

  const goto = (n: number): void => {
    if (n < 0 || n >= TOUR_STEPS.length) {
      exit();
      return;
    }
    i = n;
    render();
  };

  function exit(): void {
    i = 0;
    host.innerHTML = '';
    opts.onFocus?.(null);
  }

  render();
  return { next: () => goto(i + 1), back: () => goto(i - 1), exit };
}