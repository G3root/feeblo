import * as S from "effect/Schema";
import { describe, expect, it } from "vitest";
import { WidgetFeedbackCreate } from "./schema";

const valid = {
  boardId: "board_features",
  organizationId: "org_test",
  title: "Nice feature",
  content: "Please add this.",
};

describe("WidgetFeedbackCreate metadata", () => {
  it("accepts bounded metadata", () => {
    const parsed = S.decodeUnknownSync(WidgetFeedbackCreate)({
      ...valid,
      metadata: { page: "/pricing", utm_source: "blog" },
    });

    expect(parsed.metadata).toEqual({ page: "/pricing", utm_source: "blog" });
  });

  it("accepts empty metadata", () => {
    const parsed = S.decodeUnknownSync(WidgetFeedbackCreate)(valid);

    expect(parsed.metadata).toBeUndefined();
  });

  it("rejects metadata keys longer than 64 characters", () => {
    const tooLongKey = "k".repeat(65);

    expect(() =>
      S.decodeUnknownSync(WidgetFeedbackCreate)({
        ...valid,
        metadata: { [tooLongKey]: "x" },
      })
    ).toThrow();
  });

  it("rejects metadata values longer than 500 characters", () => {
    expect(() =>
      S.decodeUnknownSync(WidgetFeedbackCreate)({
        ...valid,
        metadata: { page: "v".repeat(501) },
      })
    ).toThrow();
  });

  it("rejects more than 20 metadata properties", () => {
    const metadata: Record<string, string> = {};
    for (let index = 0; index < 21; index++) {
      metadata[`key_${index}`] = "x";
    }

    expect(() =>
      S.decodeUnknownSync(WidgetFeedbackCreate)({
        ...valid,
        metadata,
      })
    ).toThrow();
  });
});
