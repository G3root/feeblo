import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UpvotePolicy } from "./policies";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type { TUpvoteList, TUpvoteToggle } from "./schema";

export const UpvoteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UpvoteRepository;
  const upvotePolicy = yield* UpvotePolicy;
  const subscriptionRepository = yield* PostSubscriptionRepository;
  // const sitePolicy = yield* SitePolicy;

  return {
    UpvoteList: (args: TUpvoteList) =>
      repository
        .list({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(
            upvotePolicy.canList({
              organizationId: args.organizationId,
              source: "dashboard",
            })
          ),
          withRemapDbErrors("Upvote", "select")
        ),
    UpvoteToggle: (args: TUpvoteToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);

        const result = yield* transaction(
          Effect.gen(function* () {
            const result = yield* repository.toggle({
              organizationId: args.organizationId,
              postId: args.postId,
              userId: session.session.userId,
            });

            // Upvoting a post automatically subscribes the user to it.
            if (result.upvoted) {
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.postId,
                userId: session.session.userId,
                ...(membership ? { memberId: membership.membershipId } : {}),
              });
            }

            return result;
          })
        );

        return result;
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canToggle({
            organizationId: args.organizationId,
            postId: args.postId,
            source: "dashboard",
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
    UpvoteListPublic: (args: TUpvoteList) =>
      repository
        .list({
          organizationId: args.organizationId,
        })
        .pipe(withRemapDbErrors("Upvote", "select")),
    UpvoteTogglePublic: (args: TUpvoteToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);

        //TODO: comeback later
        // yield* sitePolicy.canViewRoadmap(args.organizationId);

        const result = yield* transaction(
          Effect.gen(function* () {
            const result = yield* repository.toggle({
              organizationId: args.organizationId,
              postId: args.postId,
              userId: session.session.userId,
            });

            // Upvoting a post automatically subscribes the user to it.
            if (result.upvoted) {
              yield* subscriptionRepository.subscribe({
                organizationId: args.organizationId,
                postId: args.postId,
                userId: session.session.userId,
                ...(membership ? { memberId: membership.membershipId } : {}),
              });
            }

            return result;
          })
        );

        return result;
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canToggle({
            organizationId: args.organizationId,
            postId: args.postId,
            source: "public",
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
  };
});

export const UpvoteRpcHandlers = UpvoteRpcs.toLayer(
  UpvoteRpcHandlersEffect
).pipe(
  Layer.provide(UpvotePolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(UpvoteRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
