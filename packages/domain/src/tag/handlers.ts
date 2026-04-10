import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
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
  TChangelogTagList,
  TChangelogTagSet,
  TPostTagList,
  TPostTagSet,
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

const validatePost = ({
  postId,
  organizationId,
}: {
  postId: string;
  organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* TagRepository;
    const exists = yield* repository.hasPost({ postId, organizationId });

    if (!exists) {
      return yield* Effect.fail(
        new Policy.PolicyDeniedError({
          reason: "Post does not belong to this organization",
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
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list tags" })
              ),
          })
        ),

      TagListPublic: (args: TTagList) =>
        repository.findMany(args).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list tags" })
              ),
          })
        ),

      PostTagList: (args: TPostTagList) =>
        repository.findPostTags(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list post tags" })
              ),
          })
        ),

      PostTagListPublic: (args: TPostTagList) =>
        repository.findPostTags(args).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({ message: "Failed to list post tags" })
              ),
          })
        ),

      ChangelogTagList: (args: TChangelogTagList) =>
        repository.findChangelogTags(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list changelog tags",
                })
              ),
          })
        ),

      ChangelogTagListPublic: (args: TChangelogTagList) =>
        repository.findChangelogTags(args).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list changelog tags",
                })
              ),
          })
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
          })
        ),

      TagUpdate: (args: TTagUpdate) =>
        repository.update(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToUpdateTagError()),
          })
        ),

      TagDelete: (args: TTagDelete) =>
        repository.delete(args).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToDeleteTagError()),
          })
        ),

      PostTagSet: (args: TPostTagSet) =>
        Effect.gen(function* () {
          const tagIds = normalizeTagIds(args.tagIds);
          yield* validatePost({
            postId: args.postId,
            organizationId: args.organizationId,
          });
          yield* validateTagIds({
            organizationId: args.organizationId,
            tagIds,
            type: "FEEDBACK",
          });

          yield* repository.setPostTags({ ...args, tagIds });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () => Effect.fail(new FailedToSetTagAssignmentsError()),
          })
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
          })
        ),
    };
  })
).pipe(Layer.provide(TagRepository.Default));
