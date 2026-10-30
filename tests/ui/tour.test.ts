// @vitest-environment jsdom
import { describe, expect, test } from 'vitest';
import { createTour, TOUR_STEPS, type TourFocus } from '../../src/ui/tour.js';

function makeHost(): HTMLElement {
  return document.createElement('div');
}

describe('createTour', () => {
  test('steps exist and each names a real section target', () => {
    const ids = TOUR_STEPS.map((s) => s.target);
    expect(ids).toEqual(['listen', 'field', 'listen-knobs', 'agent-console', 'photo']);
  });

  test('renders the first step initially', () => {
    const h: HTMLElement = makeHost();
    const tour = createTour(h);
    expect(h.textContent).toContain(TOUR_STEPS[0].title);
    expect(h.querySelector('.tour-dots .active')?.textContent).toBe('1');
  });

  test('next/back walk the steps; focus callback fires (also on the initial render)', () => {
    const h = makeHost();
    const focused: (TourFocus | null)[] = [];
    const tour = createTour(h, { onFocus: (f) => focused.push(f) });
    expect(focused).toEqual([TOUR_STEPS[0].target]); // initial render focuses step 1
    tour.next();
    expect(h.textContent).toContain(TOUR_STEPS[1].title);
    tour.back();
    expect(focused).toEqual([TOUR_STEPS[0].target, TOUR_STEPS[1].target, TOUR_STEPS[0].target]);
  });

  test('next past the last step ends the tour and clears the panel', () => {
    const h = makeHost();
    const tour = createTour(h);
    for (let i = 0; i < TOUR_STEPS.length; i++) tour.next(); // exactly the step count: 5th next exits
    expect(h.innerHTML).toBe('');
  });

  test('exit clears immediately', () => {
    const h = makeHost();
    const tour = createTour(h);
    tour.exit();
    expect(h.innerHTML).toBe('');
  });
});