import { describe, expect, it } from "vitest";

import {
  countFittingTabs,
  OVERFLOW_TAB_BUTTON_MAX_PX,
} from "./view-tab-overflow";

/**
 * The tab strip's fit arithmetic.
 *
 * The bug this guards: the "N more" button carries the active view's name when
 * that view is the one clipped, so a long name used to widen the button, which
 * hid one more tab, which kept the long name on the button. Whether a tab was
 * shown therefore depended on the order the strip happened to re-measure in.
 * Reserving the button's maximum instead of its rendered width is what makes the
 * count a function of the tab widths alone.
 */
describe("countFittingTabs", () => {
  const GAP = 8;

  it("counts whole tabs only, and stops at the first that does not fit", () => {
    // 100 + 8 + 100 + 8 + 100 = 316; the fourth would need 424.
    expect(
      countFittingTabs({
        available: 400,
        gap: GAP,
        widths: [100, 100, 100, 100],
      })
    ).toEqual({ count: 3, width: 316 });
  });

  it("excludes a tab that is only partly inside the box", () => {
    // 100 + 8 + 100 = 208 fits; the third would end at 316, and 316 > 300.
    const fit = countFittingTabs({
      available: 300,
      gap: GAP,
      widths: [100, 100, 100],
    });

    expect(fit.count).toBe(2);
    expect(fit.width).toBe(208);
  });

  it("fits everything when the strip is wide enough", () => {
    expect(
      countFittingTabs({
        available: 1000,
        gap: GAP,
        widths: [120, 96, 160, 140],
      })
    ).toEqual({ count: 4, width: 120 + 8 + 96 + 8 + 160 + 8 + 140 });
  });

  it("counts nothing when there is no room for even one tab", () => {
    expect(countFittingTabs({ available: 0, gap: GAP, widths: [100] })).toEqual(
      { count: 0, width: 0 }
    );
    expect(
      countFittingTabs({
        available: -OVERFLOW_TAB_BUTTON_MAX_PX,
        gap: GAP,
        widths: [100],
      })
    ).toEqual({ count: 0, width: 0 });
  });

  it("never shows more tabs when the button's space is reserved", () => {
    // Long names, six tabs, a strip that fits three: the count with the button
    // reserved must be at or below the count without it, for every available
    // width. A count that could *grow* when space is taken away is exactly the
    // oscillation that made a clipped tab appear and disappear.
    const widths = [158, 143, 160, 120, 160, 132];

    for (let available = 0; available <= 1200; available += 8) {
      const unreserved = countFittingTabs({ available, gap: GAP, widths });
      const reserved = countFittingTabs({
        available: available - (OVERFLOW_TAB_BUTTON_MAX_PX + GAP),
        gap: GAP,
        widths,
      });

      expect(reserved.count).toBeLessThanOrEqual(unreserved.count);
    }
  });

  it("hides the last tab a long active name would otherwise keep visible", () => {
    // Reproduces the reported case: six saved views with long names in a strip
    // that fits five *without* a button. Reserving the button's space must drop
    // the sixth rather than showing it and covering it with the button.
    const widths = [158, 143, 160, 120, 160, 132];
    const gap = GAP;
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * 5;

    const unreserved = countFittingTabs({ available: total, gap, widths });
    const reserved = countFittingTabs({
      available: total - (OVERFLOW_TAB_BUTTON_MAX_PX + gap),
      gap,
      widths,
    });

    expect(unreserved.count).toBe(6);
    expect(reserved.count).toBeLessThan(6);
  });
});
