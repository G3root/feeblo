import { expect, layer } from "@effect/vitest";
import { currentDb, Database, schema } from "@feeblo/db";
import { BoardId, PostId, PostStatusId, WorkspaceId } from "@feeblo/id";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { OgImageRepository } from "./repository";

const TestLayer = Layer.mergeAll(
  OgImageRepository.layer.pipe(Layer.provide(Database.PgliteDatabaseLive)),
  Database.PgliteDatabaseLive
);

/**
 * The OG route is unauthenticated and its post lookup is addressed by slug, and
 * slugs are slugified titles. So the only thing keeping a post's title, board,
 * status and upvote count out of a rendered PNG is the query's own predicates.
 */
layer(TestLayer)("OgImageRepository", (it) => {
  const makePost = ({
    organizationId,
    boardId,
    statusId,
    title,
    archived = false,
    mergedIntoPostId = null,
  }: {
    organizationId: string;
    boardId: string;
    statusId: string;
    title: string;
    archived?: boolean;
    mergedIntoPostId?: string | null;
  }) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const id = yield* PostId.generate;
      const now = yield* DateTime.nowAsDate;
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      yield* db.insert(schema.postTable).values({
        id,
        boardId,
        organizationId,
        statusId,
        title,
        slug,
        content: "Content",
        creatorId: null,
        archivedAt: archived ? now : null,
        mergedIntoPostId,
        // The schema's check constraint requires the timestamp whenever a merge
        // target is set, and requires an archived row whenever there is one.
        mergedAt: mergedIntoPostId ? now : null,
        createdAt: now,
        updatedAt: now,
      });
      return { id, slug };
    });

  const makeFixture = ({
    visibility = "PUBLIC",
  }: { visibility?: "PUBLIC" | "PRIVATE" } = {}) =>
    Effect.gen(function* () {
      const db = yield* currentDb;
      const organizationId = yield* WorkspaceId.generate;
      const boardId = yield* BoardId.generate;
      const statusId = yield* PostStatusId.generate;
      const now = yield* DateTime.nowAsDate;

      yield* db.insert(schema.organizationTable).values({
        id: organizationId,
        name: "Test organization",
        slug: organizationId,
        createdAt: now,
      });
      yield* db.insert(schema.boardTable).values({
        id: boardId,
        organizationId,
        name: "Public board",
        slug: "public-board",
        visibility,
        createdAt: now,
        updatedAt: now,
      });
      yield* db.insert(schema.postStatusTable).values({
        id: statusId,
        organizationId,
        type: "PLANNED",
        orderIndex: 0,
      });

      return { boardId, organizationId, statusId };
    });

  it.effect("finds a post on a public board", () =>
    Effect.gen(function* () {
      const repository = yield* OgImageRepository;
      const fixture = yield* makeFixture();
      const post = yield* makePost({
        ...fixture,
        title: "Dark mode",
      });

      const found = yield* repository.findPost({
        organizationId: fixture.organizationId,
        postSlug: post.slug,
      });

      expect(Option.getOrUndefined(found)).toMatchObject({
        title: "Dark mode",
        boardName: "Public board",
        status: "PLANNED",
      });
    })
  );

  it.effect("does not find a post on a private board", () =>
    Effect.gen(function* () {
      const repository = yield* OgImageRepository;
      const fixture = yield* makeFixture({ visibility: "PRIVATE" });
      const post = yield* makePost({ ...fixture, title: "Secret roadmap" });

      const found = yield* repository.findPost({
        organizationId: fixture.organizationId,
        postSlug: post.slug,
      });

      expect(Option.isNone(found)).toBe(true);
    })
  );

  // Superseded content stays queryable internally. Rendering it here would put
  // its title, board, status and counts in a PNG served to anyone with the slug.
  it.effect("does not find an archived post", () =>
    Effect.gen(function* () {
      const repository = yield* OgImageRepository;
      const fixture = yield* makeFixture();
      const post = yield* makePost({
        ...fixture,
        title: "Archived idea",
        archived: true,
      });

      const found = yield* repository.findPost({
        organizationId: fixture.organizationId,
        postSlug: post.slug,
      });

      expect(Option.isNone(found)).toBe(true);
    })
  );

  it.effect("does not find a merged post", () =>
    Effect.gen(function* () {
      const repository = yield* OgImageRepository;
      const fixture = yield* makeFixture();
      // A merge points at a real surviving post, and the schema requires the
      // merged row to be archived too — so this post is both. Either predicate
      // excludes it; both are kept because the public post reads keep both.
      const target = yield* makePost({ ...fixture, title: "Surviving idea" });
      const post = yield* makePost({
        ...fixture,
        title: "Merged idea",
        archived: true,
        mergedIntoPostId: target.id,
      });

      const found = yield* repository.findPost({
        organizationId: fixture.organizationId,
        postSlug: post.slug,
      });

      expect(Option.isNone(found)).toBe(true);
    })
  );

  it.effect("does not find another workspace's post", () =>
    Effect.gen(function* () {
      const repository = yield* OgImageRepository;
      const fixture = yield* makeFixture();
      const other = yield* makeFixture();
      const post = yield* makePost({ ...other, title: "Foreign idea" });

      const found = yield* repository.findPost({
        organizationId: fixture.organizationId,
        postSlug: post.slug,
      });

      expect(Option.isNone(found)).toBe(true);
    })
  );
});
