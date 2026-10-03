import { describe, expect, it } from "@effect/vitest";
import { PostId } from "@feeblo/id";
import * as S from "effect/Schema";

import { EDITOR_ASSET_IDS_MAX_COUNT } from "../content-limits";
import { EtaQuarter, PostCreate } from "./schema";

const validCreate = {
  // SAFETY: the empty literal has no elements, so the assertion cannot hide a
  // non-string; it only widens the tuple for the decode input.
  assetIds: [] as string[],
  boardId: "brd_boardid000",
  content: "Body",
  id: "pst_id000000000001",
  organizationId: "org_orgid000001",
  statusId: "pss_statusid0001",
  title: "Title",
};

describe("EtaQuarter", () => {
  it("accepts the persisted quarter format", () => {
    expect(S.decodeUnknownSync(EtaQuarter)("2026-Q3")).toBe("2026-Q3");
  });

  it.each(["2026-Q0", "2026-Q5", "26-Q3", "2026-q3", "2026-Q3-extra"])(
    "rejects malformed value %s",
    (value) => {
      expect(() => S.decodeUnknownSync(EtaQuarter)(value)).toThrow(
        /^Expected a string matching the RegExp/
      );
    }
  );
});

describe("PostCreate", () => {
  it("accepts a client-minted legid-format id", () => {
    expect(S.decodeUnknownSync(PostCreate)(validCreate).id).toBe(
      "pst_id000000000001"
    );
  });

  it("round-trips an id minted by the factory", async () => {
    const id = await PostId.unsafeGenerate();
    expect(S.decodeUnknownSync(PostCreate)({ ...validCreate, id }).id).toBe(id);
  });

  it.each([
    ["wrong prefix", "cmt_validid000001"],
    ["missing prefix", "validid000000001"],
    ["invalid characters", "pst_not;drop;table"],
    ["path-like value", "pst_../../etc/passwd"],
    ["overlong value", `pst_${"a".repeat(200)}`],
    ["empty value", ""],
  ])("rejects a %s as the primary key", (_label, id) => {
    expect(() =>
      S.decodeUnknownSync(PostCreate)({ ...validCreate, id })
    ).toThrow(/Must be a valid pst_ id/);
  });

  it("accepts up to the editor asset cap", () => {
    const assetIds = Array.from(
      { length: EDITOR_ASSET_IDS_MAX_COUNT },
      () => "ast_assetid000001"
    );
    expect(
      S.decodeUnknownSync(PostCreate)({ ...validCreate, assetIds }).assetIds
    ).toHaveLength(EDITOR_ASSET_IDS_MAX_COUNT);
  });

  it("rejects an asset list past the cap", () => {
    const assetIds = Array.from(
      { length: EDITOR_ASSET_IDS_MAX_COUNT + 1 },
      () => "ast_assetid000001"
    );
    expect(() =>
      S.decodeUnknownSync(PostCreate)({ ...validCreate, assetIds })
    ).toThrow(/length of at most 50/);
  });
});
