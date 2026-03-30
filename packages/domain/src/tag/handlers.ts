import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { onInternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import {
  FailedToCreateTagError,
  FailedToDeleteTagError,
  FailedToSetTagAssignmentsError,
  FailedToUpdateTagError,
} from "./errors";
import { TagRepository } from "./repository";
import { TagRpcs } from "./rpcs";
import type {
  TBoardTagSet,
  TChangelogTagSet,
  TTag,
  TTagCreate,
  TTagDelete,
  TTagList,
  TTagUpdate,
} from "./schema";

const normalizeTagIds = (tagIds: readonly string[]) => [...new Set(tagIds)];

const validateTagIds = ({
  organizationId,
  tagIds,
  type,
}: {
  organizationId: string;
  tagIds: readonly string[];
  type?: TTag["type"];
}) =>
  Effect.gen(function* () {
    const repository = yield* TagRepository;
    const count = yield* repository.countExistingTags({
      organizationId,
      tagIds,
      type,
    });

    if (count !== tagIds.length) {
      return yield* Effect.fail(
        new Policy.PolicyDeniedError({
          reason: "One or more tags do not belong to this organization or type",
        })
      );
    }
  });

const validateBoard = ({
  boardId,
  organizationId,
}: {
  boardId: string;
  organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* TagRepository;
    const exists = yield* repository.hasBoard({ boardId, organizationId });

    if (!exists) {
      return yield* Effect.fail(
        new Policy.PolicyDeniedError({
          reason: "Board does not belong to this organization",
        })
      );
    }
  });

const validateChangelog = ({
  changelogId,
  organizationId,
}: {
  changelogId: string;
  organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* TagRepository;
    const exists = yield* repository.hasChangelog({
      changelogId,
      organizationId,
    });

    if (!exists) {
      return yield* Effect.fail(
        new Policy.PolicyDeniedError({
          reason: "Changelog does not belong to this organization",
        })
      );
    }
  });

export const TagRpcHandlers = TagRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* TagRepository;

    return {
      TagList: (args: TTagList) =>
        repository.findMany(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchAll(onInternalServerError)
        ),

      TagCreate: (args: TTagCreate) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const membership = session.memberships.find(
            (entry) => entry.organizationId === args.organizationId
          );

          yield* repository.create({
            ...args,
            creatorId: session.session.userId,
            ...(membership ? { creatorMemberId: membership.membershipId } : {}),
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToCreateTagError()),
          }),
          Effect.catchAll(onInternalServerError)
        ),

      TagUpdate: (args: TTagUpdate) =>
        repository.update(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToUpdateTagError()),
          }),
          Effect.catchAll(onInternalServerError)
        ),

      TagDelete: (args: TTagDelete) =>
        repository.delete(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToDeleteTagError()),
          }),
          Effect.catchAll(onInternalServerError)
        ),

      BoardTagSet: (args: TBoardTagSet) =>
        Effect.gen(function* () {
          const tagIds = normalizeTagIds(args.tagIds);
          yield* validateBoard({
            boardId: args.boardId,
            organizationId: args.organizationId,
          });
          yield* validateTagIds({
            organizationId: args.organizationId,
            tagIds,
            type: "FEEDBACK",
          });

          yield* repository.setBoardTags({ ...args, tagIds });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToSetTagAssignmentsError()),
          }),
          Effect.catchAll(onInternalServerError)
        ),

      ChangelogTagSet: (args: TChangelogTagSet) =>
        Effect.gen(function* () {
          const tagIds = normalizeTagIds(args.tagIds);
          yield* validateChangelog({
            changelogId: args.changelogId,
            organizationId: args.organizationId,
          });
          yield* validateTagIds({
            organizationId: args.organizationId,
            tagIds,
            type: "CHANGELOG",
          });

          yield* repository.setChangelogTags({ ...args, tagIds });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToSetTagAssignmentsError()),
          }),
          Effect.catchAll(onInternalServerError)
        ),
    };
  })
).pipe(Layer.provide(TagRepository.Default));
