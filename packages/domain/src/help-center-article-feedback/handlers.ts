import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import { HelpCenterArticleRepository } from "../help-center-article/repository";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import {
  BadRequestError,
  NotFoundError,
  withRemapDbErrors,
} from "../rpc-errors";
import { OptionalCurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { HelpCenterArticleFeedbackRepository } from "./repository";
import { HelpCenterArticleFeedbackRpcs } from "./rpcs";
import type {
  THelpCenterArticleFeedbackCast,
  THelpCenterArticleFeedbackGetPublic,
  THelpCenterArticleFeedbackList,
} from "./schema";

/**
 * The reader's identity, as the vote table's two facets expect it.
 *
 * Exactly one of the two is ever set. A signed-in reader is keyed to the
 * account so the vote follows them across browsers; an anonymous reader is
 * keyed to the browser's own random id, so signing in later does not silently
 * discard a vote they already cast — the two are different rows, and the
 * account row wins once one exists.
 */
export const HelpCenterArticleFeedbackRpcHandlersEffect = Effect.gen(
  function* () {
    const repository = yield* HelpCenterArticleFeedbackRepository;
    const articleRepository = yield* HelpCenterArticleRepository;
    const sitePolicy = yield* SitePolicy;

    /**
     * A vote names an article, so it is only count-able against an article a
     * reader could open. A draft has no public page, and answering it would
     * tell a caller that the draft exists.
     */
    const requireReadableArticle = (args: {
      organizationId: string;
      articleId: string;
    }) =>
      articleRepository
        .findById({ organizationId: args.organizationId, id: args.articleId })
        .pipe(
          Effect.flatMap((found) =>
            found === undefined || found.status === "draft"
              ? Effect.fail(
                  new NotFoundError({ message: "The article does not exist." })
                )
              : Effect.void
          )
        );

    const resolveIdentity = (visitorId: string | null | undefined) =>
      Effect.gen(function* () {
        const session = yield* OptionalCurrentSession;

        if (Option.isSome(session)) {
          return {
            userId: session.value.session.userId,
            visitorId: null,
          } as const;
        }

        if (visitorId === null || visitorId === undefined) {
          return yield* new BadRequestError({
            message: "A visitorId is required when nobody is signed in.",
          });
        }

        return { userId: null, visitorId } as const;
      });

    return {
      GetHelpCenterArticleFeedbackPublic: (
        args: THelpCenterArticleFeedbackGetPublic
      ) =>
        Effect.gen(function* () {
          // Before the tally, not after: an unreadable article must answer
          // "not found" rather than a count, which would both describe a page
          // nobody can open and confirm the draft exists.
          yield* requireReadableArticle(args);

          const identity = yield* resolveIdentity(args.visitorId);

          return yield* repository.tally({ ...args, ...identity });
        }).pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "GetHelpCenterArticleFeedbackPublic",
            level: "read",
          }),
          Policy.withPublicPolicy(
            sitePolicy.canViewHelpCenter(args.organizationId)
          ),
          withRemapDbErrors("HelpCenterArticleFeedback", "select")
        ),

      SetHelpCenterArticleFeedback: (args: THelpCenterArticleFeedbackCast) =>
        Effect.gen(function* () {
          yield* requireReadableArticle(args);

          const identity = yield* resolveIdentity(args.visitorId);

          const reason =
            args.helpful || args.reason === null || args.reason === undefined
              ? null
              : args.reason.trim() || null;

          yield* repository.cast({ ...args, ...identity, reason });

          return yield* repository.tally({ ...args, ...identity });
        }).pipe(
          RateLimit.withPublicRpcRateLimit({
            name: "SetHelpCenterArticleFeedback",
            level: "write",
          }),
          Policy.withPublicPolicy(
            sitePolicy.canViewHelpCenter(args.organizationId)
          ),
          withRemapDbErrors("HelpCenterArticleFeedback", "upsert")
        ),

      ListHelpCenterArticleFeedback: (args: THelpCenterArticleFeedbackList) =>
        repository
          .list(args)
          .pipe(
            Policy.withPolicy(
              Policy.all(
                Policy.hasMembership(args.organizationId),
                Policy.canPermission(
                  args.organizationId,
                  "helpCenterArticles.*"
                )
              )
            ),
            withRemapDbErrors("HelpCenterArticleFeedback", "select")
          ),
    };
  }
);

export const HelpCenterArticleFeedbackRpcHandlers =
  HelpCenterArticleFeedbackRpcs.toLayer(
    HelpCenterArticleFeedbackRpcHandlersEffect
  ).pipe(
    Layer.provide(SitePolicy.layer),
    Layer.provide(EntitlementPolicy.layer),
    Layer.provide(WorkspaceRepository.layer),
    Layer.provide(SiteRepository.layer),
    Layer.provide(HelpCenterArticleRepository.layer),
    Layer.provide(HelpCenterArticleFeedbackRepository.layer)
  );
