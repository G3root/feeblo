import { describe, expect, it } from "@effect/vitest";
import * as S from "effect/Schema";

import { EtaQuarter } from "./schema";

describe("EtaQuarter", () => {
  it("accepts the persisted quarter format", () => {
    expect(S.decodeUnknownSync(EtaQuarter)("2026-Q3")).toBe("2026-Q3");
  });

  it.each(["2026-Q0", "2026-Q5", "26-Q3", "2026-q3", "2026-Q3-extra"])(
    "rejects malformed value %s",
    (value) => {
      expect(() => S.decodeUnknownSync(EtaQuarter)(value)).toThrow();
    }
  );
});
