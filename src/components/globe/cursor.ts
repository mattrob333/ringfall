'use client';

/**
 * Two subsystems want the canvas cursor — the picker ("this is clickable") and
 * the camera rig ("you are dragging the planet"). Rather than let them stomp
 * each other, they both write into named slots and the highest-priority
 * non-empty slot wins.
 */

type Slot = 'drag' | 'hover';

const PRIORITY: Slot[] = ['drag', 'hover'];

const slots: Record<Slot, string> = { drag: '', hover: '' };
let element: HTMLElement | null = null;

export function bindCursorTarget(el: HTMLElement | null): void {
  element = el;
  apply();
}

export function setCursor(slot: Slot, value: string): void {
  if (slots[slot] === value) return;
  slots[slot] = value;
  apply();
}

function apply(): void {
  if (!element) return;
  for (const slot of PRIORITY) {
    if (slots[slot]) {
      element.style.cursor = slots[slot];
      return;
    }
  }
  element.style.cursor = '';
}
