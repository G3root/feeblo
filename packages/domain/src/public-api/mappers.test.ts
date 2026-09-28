import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  toPublicApiChangelog,
  toPublicApiChangelogSummary,
  toPublicApiPost,
  toPublicApiPostSummary,
  toPublicApiTag,
  toPublicApiTagDetail,
} from "./mappers";
import type {
  PublicApiChangelogDetail,
  PublicApiChangelogSource,
  PublicApiDetailedPost,
  PublicApiListedPost,
  PublicApiTagSource,
} from "./repository";
import {
  PublicApiChangelog,
  PublicApiChangelogSummary,
  PublicApiPost,
  PublicApiPostSummary,
  PublicApiTag,
  PublicApiTagDetail,
} from "./schema";

/**
 * Mapper tests.
 *
 * This is where the PII guarantee is enforced at the unit level: the mapper's
 * input type is the repository's narrow source (no actor identifiers exist to
 * pass through), and its output is encoded through the closed DTO, whose
 * encoder drops anything the schema does not declare. The exact key sets below
 * are the shape lock — a new field fails here until it is added on purpose.
 */

const CONTEXT = {
  appUrl: "https://app.feeblo.test",
  organizationId: "org_example",
} as const;

const source: PublicApiListedPost = {
  id: "pst_example",
  boardId: "brd_feedback",
  boardSlug: "feedback",
  title: "Dark mode",
  slug: "dark-mode",
  excerpt: "Please add a dark theme.",
  etaQuarter: "2026-Q3",
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T09:30:00.000Z"),
  lockedAt: null,
  archivedAt: null,
  mergedIntoPostId: null,
  status: { id: "pss_planned", name: "Planned", type: "PLANNED" },
  author: { type: "end_user", displayName: "Jamie", avatarUrl: null },
  voteCount: 12,
  commentCount: 4,
  tags: [{ id: "tag_ui", name: "UI" }],
};

const detailed: PublicApiDetailedPost = {
  ...source,
  content: "<p>Sanitized body</p>",
};

const tagSource: PublicApiTagSource = {
  id: "tag_ui",
  name: "UI",
  slug: "ui",
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T09:30:00.000Z"),
};

const changelogSource: PublicApiChangelogSource = {
  id: "chg_example",
  title: "Dark mode shipped",
  slug: "dark-mode-shipped",
  excerpt: "Dark mode is live for every workspace.",
  coverImage: null,
  status: "published",
  scheduledAt: null,
  publishedAt: new Date("2026-08-12T00:00:00.000Z"),
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T09:30:00.000Z"),
};

const changelogDetail: PublicApiChangelogDetail = {
  ...changelogSource,
  content: "Dark mode is live. Enable it in **Settings**.",
};

const CHANGELOG_LIST_KEYS = [
  "coverImage",
  "createdAt",
  "excerpt",
  "id",
  "publishedAt",
  "scheduledAt",
  "slug",
  "status",
  "title",
  "updatedAt",
];

const LIST_KEYS = [
  "archivedAt",
  "author",
  "boardId",
  "commentCount",
  "createdAt",
  "etaQuarter",
  "excerpt",
  "id",
  "lockedAt",
  "mergedIntoPostId",
  "slug",
  "status",
  "tags",
  "title",
  "updatedAt",
  "url",
  "voteCount",
];

describe("public API mappers", () => {
  it("emits exactly the documented list fields", () => {
    const encoded = Schema.encodeSync(PublicApiPostSummary)(
      toPublicApiPostSummary(source, CONTEXT)
    );

    expect(Object.keys(encoded).sort()).toEqual(LIST_KEYS);
    expect(Object.keys(encoded.author).sort()).toEqual([
      "avatarUrl",
      "displayName",
      "type",
    ]);
    expect(Object.keys(encoded.status).sort()).toEqual(["id", "name", "type"]);
  });

  it("adds only the body on the detail projection", () => {
    const encoded = Schema.encodeSync(PublicApiPost)(
      toPublicApiPost(detailed, CONTEXT)
    );

    expect(Object.keys(encoded).sort()).toEqual(
      [...LIST_KEYS, "content"].sort()
    );
  });

  it("never emits an internal actor identifier", () => {
    const encoded = JSON.stringify(
      Schema.encodeSync(PublicApiPostSummary)(
        toPublicApiPostSummary(source, CONTEXT)
      )
    );

    for (const forbidden of [
      "creatorId",
      "creatorMemberId",
      "contactId",
      "userId",
      "memberId",
      "email",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("emits exactly the documented tag fields", () => {
    const encoded = Schema.encodeSync(PublicApiTagDetail)(
      toPublicApiTagDetail(tagSource)
    );

    expect(Object.keys(encoded).sort()).toEqual([
      "createdAt",
      "id",
      "name",
      "slug",
      "updatedAt",
    ]);
  });

  it("emits exactly the documented tag reference fields", () => {
    // The reference is the same mapper behind a post's `tags` array and behind
    // the response of setting a post's tags, so one shape lock covers both.
    const encoded = Schema.encodeSync(PublicApiTag)(
      toPublicApiTag({ id: "tag_ui", name: "UI" })
    );

    expect(Object.keys(encoded).sort()).toEqual(["id", "name"]);
  });

  it("keeps a post's embedded tag to its identity", () => {
    // The embedded tag and the tag resource are separate schemas so that
    // widening one does not silently widen every post payload that carries it.
    const encoded = Schema.encodeSync(PublicApiPostSummary)(
      toPublicApiPostSummary(source, CONTEXT)
    );

    expect(Object.keys(encoded.tags[0] ?? {}).sort()).toEqual(["id", "name"]);
  });

  it("never emits a tag's internal identifiers", () => {
    const encoded = JSON.stringify(
      Schema.encodeSync(PublicApiTagDetail)(toPublicApiTagDetail(tagSource))
    );

    for (const forbidden of [
      "creatorId",
      "creatorMemberId",
      "organizationId",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("emits exactly the documented changelog fields", () => {
    const encoded = Schema.encodeSync(PublicApiChangelogSummary)(
      toPublicApiChangelogSummary(changelogSource)
    );

    expect(Object.keys(encoded).sort()).toEqual(CHANGELOG_LIST_KEYS);
  });

  it("adds only the body on the changelog detail projection", () => {
    const encoded = Schema.encodeSync(PublicApiChangelog)(
      toPublicApiChangelog(changelogDetail)
    );

    expect(Object.keys(encoded).sort()).toEqual(
      [...CHANGELOG_LIST_KEYS, "content"].sort()
    );
    expect(encoded.content).toBe(changelogDetail.content);
  });

  it("never emits a changelog entry's internal identifiers", () => {
    const encoded = JSON.stringify(
      Schema.encodeSync(PublicApiChangelog)(
        toPublicApiChangelog(changelogDetail)
      )
    );

    for (const forbidden of [
      "creatorId",
      "creatorMemberId",
      "organizationId",
      "userId",
      "email",
    ]) {
      expect(encoded).not.toContain(forbidden);
    }
  });

  it("composes the same post URL the dashboard and emails use", () => {
    const summary = toPublicApiPostSummary(source, CONTEXT);

    expect(summary.url).toBe(
      "https://app.feeblo.test/org_example/post/feedback/dark-mode"
    );
  });

  it("encodes a workspace's custom status label verbatim", () => {
    const summary = toPublicApiPostSummary(
      {
        ...source,
        status: { id: "pss_x", name: "Shipped 🎉", type: "COMPLETED" },
      },
      CONTEXT
    );

    expect(summary.status.name).toBe("Shipped 🎉");
  });

  it("falls back to a humanized name when the status label is empty", () => {
    // `post_status.label` is user-facing and may be empty until a workspace
    // customizes it; an empty name would be useless to a caller.
    const fallback = (
      type: "PENDING" | "IN_PROGRESS" | "COMPLETED",
      label = ""
    ) =>
      toPublicApiPostSummary(
        { ...source, status: { id: "pss_x", name: label, type } },
        CONTEXT
      ).status.name;

    expect(fallback("PENDING")).toBe("Pending");
    expect(fallback("IN_PROGRESS")).toBe("In progress");
    expect(fallback("COMPLETED")).toBe("Completed");
    expect(fallback("PENDING", "  ")).toBe("Pending");
  });

  it("keeps anonymous authors explicit rather than invented", () => {
    const summary = toPublicApiPostSummary(
      {
        ...source,
        author: { type: "end_user", displayName: null, avatarUrl: null },
      },
      CONTEXT
    );

    expect(summary.author).toEqual({
      type: "end_user",
      displayName: null,
      avatarUrl: null,
    });
  });
});
