import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import {
  HelpCenterTopicNotEmptyError,
  HelpCenterTopicSlugTakenError,
} from "./errors";
import { HelpCenterTopicPolicy } from "./policies";
import { HelpCenterTopicRepository } from "./repository";
import { HelpCenterTopicRpcs } from "./rpcs";
import type {
  THelpCenterTopicCreate,
  THelpCenterTopicDelete,
  THelpCenterTopicList,
  THelpCenterTopicReorder,
  THelpCenterTopicUpdate,
} from "./schema";

/**
 * The one slug rule both the create and the update use.
 *
 * A slug is part of a public URL, so `UI Kit` and `ui-kit` must not become two
 * sections that look identical in a list. A supplied slug is normalized rather
 * than trusted, and an empty result is refused instead of stored as a blank
 * path segment.
 */
const parseSlug = (args: { readonly slug: string; readonly name: string }) => {
  const slug = slugify((args.slug ?? "").trim() || args.name);

  if (slug.length === 0) {
    return Effect.fail(
      new BadRequestError({
        message: "slug must contain at least one letter or number.",
      })
    );
  }

  return Effect.succeed(slug);
};

export const HelpCenterTopicRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* HelpCenterTopicRepository;
  const topicPolicy = yield* HelpCenterTopicPolicy;
  const sitePolicy = yield* SitePolicy;

  return {
    ListHelpCenterTopics: (args: THelpCenterTopicList) =>
      repository
        .findMany(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("HelpCenterTopic", "select")
        ),

    ListHelpCenterTopicsPublic: (args: THelpCenterTopicList) =>
      repository.findManyPublished(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "ListHelpCenterTopicsPublic",
          level: "read",
        }),
        Policy.withPublicPolicy(
          sitePolicy.canViewHelpCenter(args.organizationId)
        ),
        withRemapDbErrors("HelpCenterTopic", "select")
      ),

    CreateHelpCenterTopic: (args: THelpCenterTopicCreate) =>
      Effect.gen(function* () {
        const slug = yield* parseSlug({
          slug: args.slug ?? "",
          name: args.name,
        });

        const position =
          args.position ?? (yield* repository.nextPosition(args));

        yield* repository.create({ ...args, slug, position });
      }).pipe(
        Policy.withPolicy(topicPolicy.canCreate(args.organizationId)),
        withRemapDbErrors({
          action: "create",
          entity: "HelpCenterTopic",
          onUniqueViolation: () =>
            new HelpCenterTopicSlugTakenError({ slug: args.slug ?? args.name }),
        })
      ),

    UpdateHelpCenterTopic: (args: THelpCenterTopicUpdate) =>
      Effect.gen(function* () {
        const slug = yield* parseSlug({ slug: args.slug, name: args.name });
        yield* repository.update({ ...args, slug });
      }).pipe(
        Policy.withPolicy(topicPolicy.canUpdate(args.organizationId)),
        withRemapDbErrors({
          action: "update",
          entity: "HelpCenterTopic",
          onUniqueViolation: () =>
            new HelpCenterTopicSlugTakenError({ slug: args.slug }),
        })
      ),

    DeleteHelpCenterTopic: (args: THelpCenterTopicDelete) =>
      Effect.gen(function* () {
        /**
         * A section that still holds articles is refused by
         * `help_center_article_topic_organization_fk` (`ON DELETE RESTRICT`),
         * and that refusal is an expected editing outcome rather than a fault:
         * the editor has to move or delete the articles first. Counting before
         * the delete is what turns it into a message naming the count.
         *
         * The count is a separate statement, so an article created between the
         * two lands as the constraint's refusal and surfaces as a server
         * fault. That is the right trade: the constraint is what guarantees
         * the data, and this guard exists to give the editor a sentence, not
         * to be a serialization point on a page nobody has open at the same
         * time.
         */
        const articleCount = yield* repository.countArticlesByTopic({
          organizationId: args.organizationId,
          topicId: args.id,
        });

        if (articleCount > 0) {
          return yield* new HelpCenterTopicNotEmptyError({ articleCount });
        }

        yield* repository.remove(args);
      }).pipe(
        Policy.withPolicy(topicPolicy.canDelete(args.organizationId)),
        withRemapDbErrors("HelpCenterTopic", "delete")
      ),

    ReorderHelpCenterTopics: (args: THelpCenterTopicReorder) =>
      Effect.gen(function* () {
        const owned = yield* repository.findIds(args);

        // A reorder names the whole list. A partial list applied as "these
        // first" would leave every unnamed topic at a position that now
        // collides with a named one, and the resulting order would depend on
        // the tie-break rather than on the drag.
        if (owned.length !== args.topicIds.length) {
          return yield* new BadRequestError({
            message: "Every topic in the workspace must be named exactly once.",
          });
        }

        yield* repository.setOrder(args);
      }).pipe(
        Policy.withPolicy(topicPolicy.canReorder(args.organizationId)),
        withRemapDbErrors("HelpCenterTopic", "update")
      ),
  };
});

export const HelpCenterTopicRpcHandlers = HelpCenterTopicRpcs.toLayer(
  HelpCenterTopicRpcHandlersEffect
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(HelpCenterTopicPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(HelpCenterTopicRepository.layer)
);
