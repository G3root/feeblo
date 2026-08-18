import { describe, expect, it } from "@effect/vitest";

import { sniffMediaType } from "./api-live";

const bytes = (hex: string): Uint8Array =>
  new Uint8Array(
    hex
      .trim()
      .split(/\s+/)
      .map((part) => Number.parseInt(part, 16))
  );

describe("sniffMediaType", () => {
  it("detects PNG", () => {
    expect(sniffMediaType(bytes("89 50 4e 47 0d 0a 1a 0a 00 00 00 0d"))).toBe(
      "image/png"
    );
  });

  it("detects JPEG", () => {
    expect(sniffMediaType(bytes("ff d8 ff e0 00 10 4a 46 49 46"))).toBe(
      "image/jpeg"
    );
  });

  it("detects GIF89a", () => {
    expect(sniffMediaType(bytes("47 49 46 38 39 61 01 00 01 00"))).toBe(
      "image/gif"
    );
  });

  it("detects GIF87a", () => {
    expect(sniffMediaType(bytes("47 49 46 38 37 61 01 00 01 00"))).toBe(
      "image/gif"
    );
  });

  it("rejects a truncated GIF signature", () => {
    expect(sniffMediaType(bytes("47 49 46 38"))).toBeNull();
  });

  it("detects WebP", () => {
    expect(
      sniffMediaType(bytes("52 49 46 46 1a 00 00 00 57 45 42 50 56 50 38"))
    ).toBe("image/webp");
  });

  it("rejects video content", () => {
    expect(
      sniffMediaType(bytes("00 00 00 10 66 74 79 70 69 73 6f 6d 00 00 00 00"))
    ).toBeNull();
  });

  it("returns null for unknown bytes", () => {
    expect(sniffMediaType(bytes("00 01 02 03 04"))).toBeNull();
  });

  it("returns null for empty bytes", () => {
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });
});
