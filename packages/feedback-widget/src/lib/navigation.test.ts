import { describe, expect, it } from "vitest";

import { moduleForPath, type WidgetConfig } from "./config";
import { resolveView, widgetTabs } from "./navigation";

const config = (value: Partial<WidgetConfig>): WidgetConfig => ({
  modules: ["feedback"],
  mode: "feedback",
  ...value,
});

describe("widget view resolution", () => {
  it("treats the surface roots as root views without a back control", () => {
    expect(resolveView("/")).toEqual({ backHref: null, kind: "root" });
    expect(resolveView("/updates")).toEqual({ backHref: null, kind: "root" });
  });

  it("points the compose form back at the feedback root", () => {
    expect(resolveView("/board/brd_1")).toEqual({
      backHref: "/",
      kind: "push",
    });
  });

  it("points an update detail back at the update list", () => {
    expect(resolveView("/updates/upd_1")).toEqual({
      backHref: "/updates",
      kind: "push",
    });
  });

  it("does not mistake the update list for a detail", () => {
    expect(resolveView("/updates/")).toEqual({ backHref: null, kind: "root" });
  });
});

describe("widget tabs", () => {
  it("shows the configured surfaces in order for a hub", () => {
    expect(
      widgetTabs(config({ mode: "hub", modules: ["feedback", "updates"] }))
    ).toMatchObject([
      { href: "/", label: "Feedback", module: "feedback" },
      { href: "/updates", label: "Updates", module: "updates" },
    ]);
  });

  it("keeps the configured order", () => {
    const tabs = widgetTabs(
      config({ mode: "hub", modules: ["updates", "feedback"] })
    );
    expect(tabs.map((tab) => tab.module)).toEqual(["updates", "feedback"]);
  });

  it("hides the bar for single-surface widgets", () => {
    expect(widgetTabs(config({ mode: "feedback" }))).toEqual([]);
    expect(widgetTabs(config({ mode: "updates" }))).toEqual([]);
    expect(widgetTabs(config({ mode: "hub", modules: ["updates"] }))).toEqual(
      []
    );
  });
});

describe("active module", () => {
  it("keeps a surface highlighted while its pushed views are open", () => {
    expect(moduleForPath("/board/brd_1")).toBe("feedback");
    expect(moduleForPath("/updates/upd_1")).toBe("updates");
    expect(moduleForPath("/")).toBe("feedback");
  });
});
