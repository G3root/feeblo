import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { PostReactionRepository } from "./repository";
import { PostReactionRpcs } from "./rpcs";
import type { TPostReactionList, TPostReactionToggle } from "./schema";

export const PostReactionRpcHandlers = PostReactionRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* PostReactionRepository;
    const postPolicy = yield* PostPolicy;
    // const sitePolicy = yield* SitePolicy;

    return {
      PostReactionList: (args: TPostReactionList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.list({
            postId: args.postId,
            organizationId: args.organizationId,
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list post reactions",
                })
              ),
          })
        ),
      PostReactionToggle: (args: TPostReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
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
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle post reaction",
                })
              ),
          })
        ),
      PostReactionListPublic: (args: TPostReactionList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.listPublic({
            postId: args.postId,
            organizationId: args.organizationId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list post reactions",
                })
              ),
          })
        ),
      PostReactionTogglePublic: (args: TPostReactionToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);

          return yield* repository.togglePublic({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
            emoji: args.emoji,
          });
        }).pipe(
          Policy.withPolicy(
            postPolicy.isUnlockedPublic({
              organizationId: args.organizationId,
              postId: args.postId,
            })
          ),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle post reaction",
                })
              ),
          })
        ),
    };
  })
).pipe(
  // Layer.provide(SitePolicy.layer),
  Layer.provide(PostPolicy.layer),
  Layer.provide(PostReactionRepository.layer)
);
