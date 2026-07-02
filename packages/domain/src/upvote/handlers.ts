import { Database } from "@feeblo/db";
import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type { TUpvoteList, TUpvoteToggle } from "./schema";

export const UpvoteRpcHandlers = UpvoteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* UpvoteRepository;
    const postPolicy = yield* PostPolicy;
    const subscriptionRepository = yield* PostSubscriptionRepository;
    // const sitePolicy = yield* SitePolicy;

    return {
      UpvoteList: (args: TUpvoteList) =>
        repository
          .list({
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Upvote", "select")
          ),
      UpvoteToggle: (args: TUpvoteToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const membership = Policy.getMembership(session, args.organizationId);
          const db = yield* Database.Database;

          const result = yield* db.transaction(
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
            Policy.all(
              Policy.hasMembership(args.organizationId),
              postPolicy.isUnlocked({
                organizationId: args.organizationId,
                postId: args.postId,
              })
            )
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
          const db = yield* Database.Database;

          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);

          const result = yield* db.transaction(
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
            postPolicy.isUnlockedPublic({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          ),
          withRemapDbErrors("Upvote", "update")
        ),
    };
  })
).pipe(
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostRepository.layer),
  Layer.provide(UpvoteRepository.layer),
  Layer.provide(PostSubscriptionRepository.layer)
);
