import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { TagPolicy } from "./policies";
import { postTagChangeActivities } from "./post-tag-activities";
import { TagRepository } from "./repository";
import { TagRpcs } from "./rpcs";
import type {
  TPostTagList,
  TPostTagSet,
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
}: {
  organizationId: string;
  tagIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const repository = yield* TagRepository;
    const count = yield* repository.countExistingTags({
      organizationId,
      tagIds,
    });

    if (count !== tagIds.length) {
      return yield* new Policy.PolicyDeniedError({
        reason: "One or more tags do not belong to this organization",
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

export const TagRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* TagRepository;
  const tagPolicy = yield* TagPolicy;
  const postActivityRepository = yield* PostActivityRepository;

  return {
    TagList: (args: TTagList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    TagListPublic: (args: TTagList) =>
      repository
        .findManyPublic({
          organizationId: args.organizationId,
          includeFeedback: true,
        })
        .pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "TagListPublic",
            level: "read",
          }),
          withRemapDbErrors("Tag", "select")
        ),

    PostTagList: (args: TPostTagList) =>
      repository
        .findPostTags(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    PostTagListPublic: (args: TPostTagList) =>
      repository.findPostTags(args, { publicOnly: true }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "PostTagListPublic",
          level: "read",
        }),
        withRemapDbErrors("Tag", "select")
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
          ...(membership && { creatorMemberId: membership.membershipId }),
        });
      }).pipe(
        Policy.withPolicy(tagPolicy.canCreate(args.organizationId)),
        withRemapDbErrors("Tag", "create")
      ),

    TagUpdate: (args: TTagUpdate) =>
      Effect.gen(function* () {
        yield* repository.update(args);
      }).pipe(
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
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        const tagIds = normalizeTagIds(args.tagIds);
        yield* validatePost({
          postId: args.postId,
          organizationId: args.organizationId,
        });
        yield* validateTagIds({
          organizationId: args.organizationId,
          tagIds,
        });

        const actor = {
          actorId: session.session.userId,
          actorMemberId: membership?.membershipId ?? null,
          organizationId: args.organizationId,
          postId: args.postId,
        };

        yield* transaction(
          Effect.gen(function* () {
            const previousTagIds = yield* repository.findPostTagIds(args);
            yield* repository.setPostTags({ ...args, tagIds });

            yield* postActivityRepository.createMany(
              postTagChangeActivities({
                previousTagIds,
                nextTagIds: tagIds,
                actor,
              })
            );
          })
        );
      }).pipe(
        Policy.withPolicy(tagPolicy.canSetPostTags(args)),
        withRemapDbErrors("Tag", "update")
      ),
  };
});

export const TagRpcHandlers = TagRpcs.toLayer(TagRpcHandlersEffect).pipe(
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(TagPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(TagRepository.layer)
);
