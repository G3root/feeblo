/**
 * The resting state of a detail-panel property value: no border, background,
 * or chevron until the member hovers, presses, or opens it.
 */
export const GHOST_PROPERTY_TRIGGER =
  "w-auto border-transparent bg-transparent shadow-none before:hidden hover:bg-accent aria-expanded:bg-accent data-pressed:bg-accent";
