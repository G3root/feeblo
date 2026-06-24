import { describe, expect, it } from "vitest";
import { EmbedError } from "../src/errors";

describe("EmbedError", () => {
  it("carries a stable code and message", () => {
    const err = new EmbedError({ code: "INVALID_ORG", message: "bad org" });

    expect(err.code).toBe("INVALID_ORG");
    expect(err.message).toBe("bad org");
    expect(err.name).toBe("EmbedError");
  });

  it("is an instance of Error", () => {
    const err = new EmbedError({ code: "TEST", message: "test" });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EmbedError);
  });
});
