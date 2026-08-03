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

  it("detects MP4 with an isom brand", () => {
    expect(
      sniffMediaType(bytes("00 00 00 18 66 74 79 70 69 73 6f 6d 00 00 02 00"))
    ).toBe("video/mp4");
  });

  it("detects MP4 with an mp42 brand", () => {
    expect(
      sniffMediaType(bytes("00 00 00 18 66 74 79 70 6d 70 34 32 00 00 00 00"))
    ).toBe("video/mp4");
  });

  it("detects MP4 with a newer major brand", () => {
    expect(
      sniffMediaType(
        bytes("00 00 00 1c 66 74 79 70 69 73 6f 36 00 00 00 00 69 73 6f 6d")
      )
    ).toBe("video/mp4");
  });

  it("detects MP4 through a compatible brand", () => {
    expect(
      sniffMediaType(
        bytes("00 00 00 1c 66 74 79 70 7a 7a 7a 7a 00 00 00 00 69 73 6f 6d")
      )
    ).toBe("video/mp4");
  });

  it("detects MOV with a qt brand", () => {
    expect(
      sniffMediaType(bytes("00 00 00 14 66 74 79 70 71 74 20 20 00 00 00 00"))
    ).toBe("video/quicktime");
  });

  it("does not classify a quicktime-branded file as mp4", () => {
    expect(
      sniffMediaType(bytes("00 00 00 14 66 74 79 70 71 74 20 20 00 00 00 00"))
    ).not.toBe("video/mp4");
  });

  it("does not classify an mp4-branded file as quicktime", () => {
    expect(
      sniffMediaType(bytes("00 00 00 18 66 74 79 70 69 73 6f 6d 00 00 02 00"))
    ).not.toBe("video/quicktime");
  });

  it("rejects a truncated ftyp signature", () => {
    expect(sniffMediaType(bytes("00 00 00 18 66 74 79 70"))).toBeNull();
  });

  it("rejects an ftyp box without a supported brand", () => {
    expect(
      sniffMediaType(bytes("00 00 00 18 66 74 79 70 61 62 63 64 00 00 00 00"))
    ).toBeNull();
  });

  it("detects WebM", () => {
    expect(
      sniffMediaType(
        bytes(`
          1a 45 df a3
          9f
          42 86 81 01
          42 f7 81 01
          42 f2 81 04
          42 f3 81 08
          42 82 84 77 65 62 6d
          42 87 81 04
          42 85 81 02
        `)
      )
    ).toBe("video/webm");
  });

  it("rejects a matroska file as webm", () => {
    expect(
      sniffMediaType(
        bytes(`
          1a 45 df a3
          a4
          42 86 81 01
          42 f7 81 01
          42 f2 81 04
          42 f3 81 08
          42 82 88 6d 61 74 72 6f 73 6b 61
          42 87 81 04
          42 85 81 02
        `)
      )
    ).toBeNull();
  });

  it("rejects a truncated EBML signature", () => {
    expect(sniffMediaType(bytes("1a 45 df a3"))).toBeNull();
  });

  it("rejects a truncated webm header", () => {
    expect(sniffMediaType(bytes("1a 45 df a3 9f"))).toBeNull();
  });

  it("returns null for unknown bytes", () => {
    expect(sniffMediaType(bytes("00 01 02 03 04"))).toBeNull();
  });

  it("returns null for empty bytes", () => {
    expect(sniffMediaType(new Uint8Array())).toBeNull();
  });
});
