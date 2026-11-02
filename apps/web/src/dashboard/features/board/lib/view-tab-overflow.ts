/**
 * How many tabs fit in a strip, and how wide the visible ones are.
 *
 * Extracted from the component because it is the one piece of the tab strip
 * that is arithmetic rather than DOM: the width of a tab is its name's width,
 * so this is what decides whether a long name pushes its neighbour into the
 * overflow menu.
 */

/**
 * The width the "N more" button is allowed to take, and the width reserved for
 * it while deciding how many tabs fit.
 *
 * One number for both, and a *constant* rather than the button's measured
 * width, because the button's label is derived from the result of this
 * calculation: it shows the active tab's name when that tab is the one that had
 * to be clipped. Measuring the label would feed the answer back into its own
 * input — a long name widens the button, hides one more tab, which keeps the
 * name on the button, and the two states take turns as the strip re-measures.
 * Reserving the maximum makes the decision independent of what the label says.
 */
export const OVERFLOW_TAB_BUTTON_MAX_PX = 160;

/** The floor the button keeps, so "3 more" and a clipped name look deliberate. */
export const OVERFLOW_TAB_BUTTON_MIN_PX = 96;

export type TabFit = {
  /** Tabs that are fully inside the visible box. */
  count: number;
  /** Right edge of the last visible tab, relative to the strip's left edge. */
  width: number;
};

/**
 * Walks the tabs in order and stops at the first one that does not fit.
 *
 * A tab that is only partly inside the box is *not* counted: the strip would
 * otherwise show a half-clipped pill at its edge. `width` is therefore the
 * right edge of the last whole tab, which is what the strip is capped to — so
 * the clipped tabs sit past the cap instead of leaving a gap before the "more"
 * button.
 */
export const countFittingTabs = ({
  available,
  gap,
  widths,
}: {
  available: number;
  gap: number;
  widths: readonly number[];
}): TabFit => {
  if (available <= 0) {
    return { count: 0, width: 0 };
  }

  let count = 0;
  let edge = 0;

  for (const [index, width] of widths.entries()) {
    // `edge` is the right edge *after* this tab, gaps included: the tab itself,
    // plus the gap that preceded it (except for the first).
    const right = edge + (index === 0 ? 0 : gap) + width;

    if (right > available + 0.5) {
      break;
    }
    count += 1;
    edge = right;
  }

  return { count, width: edge };
};
