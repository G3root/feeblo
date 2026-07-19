import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { TagPolicy } from "./policies";
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

const normalizeTagIds = <T extends string>(tagIds: readonly T[]): T[] => [
  ...new Set(tagIds),
];

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
      ...(type ? { type } : {}),
    });

    if (count !== tagIds.length) {
      return yield* new Policy.PolicyDeniedError({
        reason: "One or more tags do not belong to this organization or type",
      });
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
      return yield* new Policy.PolicyDeniedError({
        reason: "Post does not belong to this organization",
      });
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
      return yield* new Policy.PolicyDeniedError({
        reason: "Changelog does not belong to this organization",
      });
    }
  });

export const TagRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* TagRepository;
  const tagPolicy = yield* TagPolicy;

  return {
    TagList: (args: TTagList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    TagListPublic: (args: TTagList) =>
      repository.findMany(args).pipe(withRemapDbErrors("Tag", "select")),

    PostTagList: (args: TPostTagList) =>
      repository
        .findPostTags(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    PostTagListPublic: (args: TPostTagList) =>
      repository.findPostTags(args).pipe(withRemapDbErrors("Tag", "select")),

    ChangelogTagList: (args: TChangelogTagList) =>
      repository
        .findChangelogTags(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    ChangelogTagListPublic: (args: TChangelogTagList) =>
      repository
        .findChangelogTags(args)
        .pipe(withRemapDbErrors("Tag", "select")),

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
        Policy.withPolicy(tagPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("Tag", "create")
      ),

    TagUpdate: (args: TTagUpdate) =>
      repository.update(args).pipe(
        Policy.withPolicy(
          tagPolicy.canUpdate({
            organizationId: args.organizationId,
            tagId: args.id,
          })
        ),
        withRemapDbErrors("Tag", "update")
      ),

    TagDelete: (args: TTagDelete) =>
      repository.delete(args).pipe(
        Policy.withPolicy(
          tagPolicy.canDelete({
            organizationId: args.organizationId,
            tagId: args.id,
          })
        ),
        withRemapDbErrors("Tag", "delete")
      ),

    PostTagSet: (args: TPostTagSet) =>
      Effect.gen(function* () {
        //TODO add ownership Policy
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
        withRemapDbErrors("Tag", "update")
      ),

    ChangelogTagSet: (args: TChangelogTagSet) =>
      Effect.gen(function* () {
        //TODO add ownership Policy
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
        withRemapDbErrors("Tag", "update")
      ),
  };
});

export const TagRpcHandlers = TagRpcs.toLayer(TagRpcHandlersEffect).pipe(
  Layer.provide(TagPolicy.layer),
  Layer.provide(TagRepository.layer)
);
