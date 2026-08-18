import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
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
      ...(type && { type }),
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
  const sitePolicy = yield* SitePolicy;
  const siteRepository = yield* SiteRepository;

  return {
    TagList: (args: TTagList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    TagListPublic: (args: TTagList) =>
      Effect.gen(function* () {
        const site = yield* siteRepository.findByOrganizationId(args);
        if (site._tag === "None") {
          return [];
        }
        return yield* repository.findManyPublic({
          organizationId: args.organizationId,
          // Feedback tags are rendered alongside public-board posts and are
          // independent from the roadmap's visibility setting.
          includeFeedback: true,
          includeChangelog: site.value.changelogVisibility === "PUBLIC",
        });
      }).pipe(
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

    ChangelogTagList: (args: TChangelogTagList) =>
      repository
        .findChangelogTags(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Tag", "select")
        ),

    ChangelogTagListPublic: (args: TChangelogTagList) =>
      repository.findChangelogTags(args, { publishedOnly: true }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ChangelogTagListPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewChangelog(args.organizationId)
        ),
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
        Policy.withPolicy(tagPolicy.canSetPostTags(args)),
        withRemapDbErrors("Tag", "update")
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
        Policy.withPolicy(tagPolicy.canSetChangelogTags(args)),
        withRemapDbErrors("Tag", "update")
      ),
  };
});

export const TagRpcHandlers = TagRpcs.toLayer(TagRpcHandlersEffect).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(TagPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(TagRepository.layer)
);
