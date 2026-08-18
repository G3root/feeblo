import { describe, expect, it } from "vitest";

import { normalizeWidgetConfig } from "../src/config";
import { EmbedError } from "../src/errors";

describe("normalizeWidgetConfig", () => {
  it("defaults to focused feedback", () => {
    expect(normalizeWidgetConfig({})).toEqual({
      mode: "feedback",
      modules: ["feedback"],
    });
  });

  it("defaults Hub modules in feedback, updates order", () => {
    expect(normalizeWidgetConfig({ mode: "hub" })).toEqual({
      mode: "hub",
      modules: ["feedback", "updates"],
    });
  });

  it("preserves an ordered Hub subset", () => {
    expect(
      normalizeWidgetConfig({ mode: "hub", modules: ["updates", "feedback"] })
    ).toMatchObject({ modules: ["updates", "feedback"] });
  });

  it.each([
    { mode: "hub" as const, modules: [] },
    { mode: "hub" as const, modules: ["feedback", "feedback"] as const },
    { mode: "feedback" as const, modules: ["feedback"] as const },
  ])("rejects invalid configuration %#", (options) => {
    expect(() =>
      normalizeWidgetConfig({
        ...options,
        modules: [...options.modules],
      })
    ).toThrow(EmbedError);
  });

  it("rejects an unrecognized mode", () => {
    expect(() =>
      normalizeWidgetConfig({ mode: "unsupported" as never })
    ).toThrow(EmbedError);
  });

  it("rejects an unrecognized placement", () => {
    expect(() =>
      normalizeWidgetConfig({ placement: "unsupported" as never })
    ).toThrow(EmbedError);
  });
});
