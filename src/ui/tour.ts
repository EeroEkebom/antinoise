/** In-app 60-second tour: a dismissible card that walks the page, section by section. */

export type TourFocus = string; // element id

export type TourStep = { target: TourFocus; title: string; body: string };

export const TOUR_STEPS: TourStep[] = [
  {
    target: 'listen',
    title: '1 · Hear the physics',
    body: 'Pick a traffic mix, then flip between "Traffic noise" and "With Antinoise field". Same traffic, one flip: the quiet zone hears the field — ~20 dB less rumble. Headphones recommended.',
  },
  {
    target: 'field',
    title: '2 · The field map',
    body: 'Drag the sensor tower (closer to the road = longer fiber lead), the cancel array, and the quiet zone. The shaded bands mark where cancellation is physically honest; the teal sum-curve below is what the zone actually hears.',
  },
  {
    target: 'listen-knobs',
    title: '3 · The knobs',
    body: 'Array nodes widen the honest quiet band; node spacing spreads them along the road; wave frequency re-renders the map at 63–630 Hz — watch the wavelength cap shrink the zone as the waves shorten; traffic level scales loudness (but not reduction — feedforward is scale-invariant).',
  },
  {
    target: 'agent-console',
    title: '4 · The commissioning agent',
    body: 'Meta\'s open-weights Muse Spark Open reads the live field (dB, lead, geometry) and proposes validated physical changes — you see its reasoning: observed → decided → applied, with the measured after-dB. If it cannot improve honestly, it stands down.',
  },
  {
    target: 'photo',
    title: '5 · Place from a photo',
    body: 'Paste a public street photo URL: SAM 3.1 segments the road and open ground, and proposes a placement from the photo\'s proportions — you confirm before it applies.',
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