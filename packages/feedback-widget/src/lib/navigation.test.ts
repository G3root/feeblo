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

  it("treats the help list as a root and an article as a pushed page", () => {
    expect(resolveView("/help")).toEqual({ backHref: null, kind: "root" });
    expect(resolveView("/help/publish-a-changelog")).toEqual({
      backHref: "/help",
      kind: "push",
    });
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

  it("shows the help tab once the workspace confirms it has documentation", () => {
    const hub = config({
      mode: "hub",
      modules: ["feedback", "updates", "help"],
    });

    expect(
      widgetTabs(hub, { helpAvailable: true }).map((tab) => tab.module)
    ).toEqual(["feedback", "updates", "help"]);
  });

  it("leaves the help tab out until it is known to exist", () => {
    const hub = config({
      mode: "hub",
      modules: ["feedback", "updates", "help"],
    });

    // `undefined` is "not answered yet", not "yes": a tab must not appear and
    // then vanish under the reader's finger.
    expect(widgetTabs(hub).map((tab) => tab.module)).toEqual([
      "feedback",
      "updates",
    ]);
    expect(
      widgetTabs(hub, { helpAvailable: false }).map((tab) => tab.module)
    ).toEqual(["feedback", "updates"]);
  });

  it("does not show a bar for one surface plus an unavailable help module", () => {
    expect(
      widgetTabs(config({ mode: "hub", modules: ["updates", "help"] }), {
        helpAvailable: false,
      })
    ).toEqual([]);
  });
});

describe("active module", () => {
  it("keeps a surface highlighted while its pushed views are open", () => {
    expect(moduleForPath("/board/brd_1")).toBe("feedback");
    expect(moduleForPath("/updates/upd_1")).toBe("updates");
    expect(moduleForPath("/help")).toBe("help");
    expect(moduleForPath("/help/invoices")).toBe("help");
    expect(moduleForPath("/")).toBe("feedback");
  });
});
