import { hasPublicApiScope } from "@feeblo/domain-contracts/public-api-scope";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { wakeEmailOutboxBestEffort } from "../../email-outbox/queue";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  invalidRequestError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { PublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { toPublicApiChangelog, toPublicApiChangelogSummary } from "./mappers";
import { PublicApiChangelogRepository } from "./repository";
import {
  CreateChangelogInput,
  DeleteChangelogInput,
  GetChangelogInput,
  ListChangelogInput,
  PublicApiChangelog,
  PublicApiChangelogPage,
  type TPublicApiChangelogWriteStatus,
  UpdateChangelogInput,
} from "./schema";

const CHANGELOG_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

const CHANGELOG_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  ConflictError,
  InternalError,
]);

const CHANGELOG_UPDATE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
]);

const CHANGELOG_DELETE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * The write fields both the create and the update share, normalized.
 *
 * The title is trimmed because it is stored and slugified, and a trailing
 * space that survives into a slug is a URL a reader cannot type back. The slug
 * is always the one `slugify` produced, from the supplied value or the title,
 * so `UI Kit` and `ui-kit` cannot become two entries that look identical in a
 * feed. `publishedAt` is the only timestamp validated against its status: a
 * publish that carried no date would have the server invent one that decides
 * an ordering readers see. `scheduledAt` rides along and is stored (always
 * cleared by a write today — see `PublicApiChangelogWriteStatus`), so a
 * scheduled-publishing future can pick the field up without another wire
 * change.
 */
const parseChangelogWrite = (write: {
  readonly content: string;
  readonly coverImage?: string | null | undefined;
  readonly publishedAt?: Date | null | undefined;
  readonly scheduledAt?: Date | null | undefined;
  readonly slug?: string | undefined;
  readonly status: TPublicApiChangelogWriteStatus;
  readonly title: string;
}) =>
  Effect.gen(function* () {
    const title = write.title.trim();
    if (title.length === 0) {
      return yield* invalidRequestError("title must not be empty.");
    }

    const slug = slugify((write.slug ?? "").trim() || title);
    if (slug.length === 0) {
      return yield* invalidRequestError(
        "slug must contain at least one letter or number."
      );
    }

    if (write.status === "published" && write.publishedAt == null) {
      return yield* invalidRequestError(
        "publishedAt is required when status is published."
      );
    }

    return {
      content: write.content,
      coverImage: write.coverImage ?? null,
      publishedAt: write.publishedAt ?? null,
      scheduledAt: write.scheduledAt ?? null,
      slug,
      status: write.status,
      title,
    };
  });

/**
 * The changelog operations.
 *
 * The row writes are `ChangelogRepository`'s own and the publication side
 * effects are `makeChangelogPublication`'s, so publishing from an API key
 * reaches subscribers exactly as publishing from the editor does. What is
 * specific here is the scope decision: `changelog.publish` is required only
 * when the write actually publishes, and the decision is made inside the
 * write's transaction against the locked status.
 */

export const listChangelogOperation = defineOperation(
  "listChangelog",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "List the workspace's changelog entries, newest first.",
    failure: CHANGELOG_READ_FAILURES,
    input: ListChangelogInput,
    output: PublicApiChangelogPage,
    scope: "changelog.read",
  },
  ({ cursor, limit, status }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiChangelogRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .list({
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          status: status ?? null,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return {
        data: page.entries.map(toPublicApiChangelogSummary),
        nextCursor:
          page.nextCursor === null ? null : encodeCursor(page.nextCursor),
      };
    })
);

export const getChangelogOperation = defineOperation(
  "getChangelog",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Read one changelog entry by id.",
    failure: CHANGELOG_READ_FAILURES,
    input: GetChangelogInput,
    output: PublicApiChangelog,
    scope: "changelog.read",
  },
  ({ changelogId }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiChangelogRepository;

      const entry = yield* repository
        .find({
          changelogId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(entry, {
        onNone: () => Effect.fail(notFoundError("Changelog entry not found.")),
        onSome: (found) => Effect.succeed(toPublicApiChangelog(found)),
      });
    })
);

export const createChangelogOperation = defineOperation(
  "createChangelog",
  {
    description: "Create a changelog entry; publishing requires its scope.",
    failure: CHANGELOG_CREATE_FAILURES,
    input: CreateChangelogInput,
    output: PublicApiChangelog,
    scope: "changelog.create",
  },
  (payload) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiChangelogRepository;

      const write = yield* parseChangelogWrite({
        ...payload,
        status: payload.status ?? "draft",
      });
      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        write.content
      );

      // The publish scope travels into the write rather than being
      // required here: a create that starts as a draft does not need it,
      // and only the write knows whether the request publishes.
      const created = yield* repository
        .create({
          ...write,
          allowPublish: hasPublicApiScope(caller.scopes, "changelog.publish"),
          content: sanitizedMarkdown,
          excerpt: htmlToExcerpt(sanitizedHtml),
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      // After the commit, best-effort: the intent is already durable, so a
      // wake that fails costs latency, not the email, and reconciliation
      // picks it up.
      yield* wakeEmailOutboxBestEffort(created.outboxId, caller.organizationId);

      return toPublicApiChangelog(created.entry);
    })
);

export const updateChangelogOperation = defineOperation(
  "updateChangelog",
  {
    description: "Replace a changelog entry's writable fields.",
    failure: CHANGELOG_UPDATE_FAILURES,
    input: UpdateChangelogInput,
    output: PublicApiChangelog,
    scope: "changelog.update",
  },
  ({ changelogId, ...payload }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiChangelogRepository;

      const write = yield* parseChangelogWrite(payload);
      const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
        write.content
      );

      // A `published` update that is not a transition is an ordinary edit
      // of an already-published entry and does not need `changelog.publish`;
      // the write decides from the locked status, so a race cannot turn a
      // draft into a broadcast for a key that never held the scope.
      const updated = yield* repository
        .update({
          ...write,
          allowPublish: hasPublicApiScope(caller.scopes, "changelog.publish"),
          changelogId,
          content: sanitizedMarkdown,
          excerpt: htmlToExcerpt(sanitizedHtml),
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      yield* wakeEmailOutboxBestEffort(updated.outboxId, caller.organizationId);

      return toPublicApiChangelog(updated.entry);
    })
);

export const deleteChangelogOperation = defineOperation(
  "deleteChangelog",
  {
    annotations: { destructive: true },
    description: "Delete a changelog entry and its links to posts.",
    failure: CHANGELOG_DELETE_FAILURES,
    input: DeleteChangelogInput,
    output: Schema.Void,
    scope: "changelog.delete",
  },
  ({ changelogId }) =>
    Effect.gen(function* () {
      const caller = yield* PublicApiCaller;
      const repository = yield* PublicApiChangelogRepository;

      // A delete that matches no row is a 404 rather than a success: the
      // caller cannot tell a delete that worked from one that named the
      // wrong workspace, and the second is worth knowing.
      const deleted = yield* repository
        .delete({
          changelogId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (!deleted) {
        return yield* notFoundError("Changelog entry not found.");
      }

      return undefined;
    })
);

export const changelogOperations = [
  listChangelogOperation,
  getChangelogOperation,
  createChangelogOperation,
  updateChangelogOperation,
  deleteChangelogOperation,
] as const;
