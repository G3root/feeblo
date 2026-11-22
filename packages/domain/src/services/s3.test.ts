import { describe, expect, it } from "@effect/vitest";

import {
  isTemporaryEditorMediaKey,
  objectCacheControl,
  promotedEditorKey,
} from "./s3";

describe("promotedEditorKey", () => {
  const sourceKey = "tmp/editor-media/user_1/image/1-a.png";

  it("drops the temporary prefix and keeps the extension", () => {
    expect(promotedEditorKey(sourceKey, "ast_first")).toBe(
      "editor-media/user_1/image/1-a-ast_first.png"
    );
  });

  it("keeps no-extension keys usable", () => {
    expect(
      promotedEditorKey("tmp/editor-media/user_1/image/recording", "ast_x")
    ).toBe("editor-media/user_1/image/recording-ast_x");
  });

  it("gives each promotion attempt its own object", () => {
    // A failed save rolls its copy back; the winner's key must be untouched.
    expect(promotedEditorKey(sourceKey, "ast_first")).not.toBe(
      promotedEditorKey(sourceKey, "ast_second")
    );
  });
});

describe("isTemporaryEditorMediaKey", () => {
  it("matches the temporary prefix and nothing else", () => {
    expect(
      isTemporaryEditorMediaKey("tmp/editor-media/user_1/image/1-a.png")
    ).toBe(true);
    // The promoted key drops `tmp/`, so a promoted object is not temporary
    // even though it started life under the temporary prefix.
    expect(isTemporaryEditorMediaKey("editor-media/user_1/image/1-a.png")).toBe(
      false
    );
    expect(isTemporaryEditorMediaKey("profile-images/user_1/1-a.png")).toBe(
      false
    );
    expect(isTemporaryEditorMediaKey("tmp/editor-media-archive/1-a.png")).toBe(
      false
    );
  });
});

describe("objectCacheControl", () => {
  // These two values are a retention decision, not an implementation detail:
  // the temporary TTL bounds how long a lifecycle-deleted upload stays
  // readable from a CDN that already served it.
  it("serves temporary objects for an hour", () => {
    expect(objectCacheControl("tmp/editor-media/user_1/image/1-a.png")).toBe(
      "public, max-age=3600"
    );
  });

  it("serves permanent objects for a day", () => {
    expect(objectCacheControl("editor-media/user_1/image/1-a.png")).toBe(
      "public, max-age=86400"
    );
    expect(objectCacheControl("profile-images/user_1/1-a.png")).toBe(
      "public, max-age=86400"
    );
    expect(objectCacheControl("organization-logos/org_1/1-a.png")).toBe(
      "public, max-age=86400"
    );
  });
});
