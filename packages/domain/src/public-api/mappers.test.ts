import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  toPublicApiCompany,
  toPublicApiPost,
  toPublicApiPostSummary,
  toPublicApiTag,
  toPublicApiTagDetail,
} from "./mappers";
import type {
  PublicApiCompanySource,
  PublicApiDetailedPost,
  PublicApiListedPost,
  PublicApiTagSource,
} from "./repository";
import {
  PublicApiCompany,
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

const companySource: PublicApiCompanySource = {
  id: "cmp_acme",
  name: "Acme",
  externalId: "crm-1",
  avatar: null,
  externalCreatedAt: new Date("2026-01-02T00:00:00.000Z"),
  source: "API",
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-12T09:30:00.000Z"),
};

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

  it("emits exactly the documented company fields", () => {
    const encoded = Schema.encodeSync(PublicApiCompany)(
      toPublicApiCompany(companySource)
    );

    expect(Object.keys(encoded).sort()).toEqual([
      "avatar",
      "createdAt",
      "externalCreatedAt",
      "externalId",
      "id",
      "name",
      "source",
      "updatedAt",
    ]);
  });

  it("drops anything a company row carries beyond the contract", () => {
    // Deliberately a variable rather than an inline literal, so the extra
    // fields survive the type checker: the point is that the closed struct,
    // not the source type, is what keeps them out of the payload.
    const withExtraColumns = {
      ...companySource,
      organizationId: "org_example",
      attributeValues: [{ attributeId: "cad_size", value: "enterprise" }],
    };

    const encoded = JSON.stringify(
      Schema.encodeSync(PublicApiCompany)(toPublicApiCompany(withExtraColumns))
    );

    for (const forbidden of [
      "organizationId",
      "attributeValues",
      "creatorId",
      "org_example",
      "enterprise",
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
