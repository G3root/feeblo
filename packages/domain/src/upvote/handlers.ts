import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { PostRepository } from "../post/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type { TUpvoteList, TUpvoteToggle } from "./schema";

export const UpvoteRpcHandlers = UpvoteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* UpvoteRepository;
    const postPolicy = yield* PostPolicy;
    // const sitePolicy = yield* SitePolicy;

    return {
      UpvoteList: (args: TUpvoteList) =>
        repository
          .list({
            postId: args.postId,
            organizationId: args.organizationId,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Upvote", "select")
          ),
      UpvoteToggle: (args: TUpvoteToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
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
          withRemapDbErrors("Upvote", "update")
        ),
      UpvoteListPublic: (args: TUpvoteList) =>
        repository
          .list({
            postId: args.postId,
            organizationId: args.organizationId,
          })
          .pipe(withRemapDbErrors("Upvote", "select")),
      UpvoteTogglePublic: (args: TUpvoteToggle) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;

          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);

          return yield* repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          });
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
  Layer.provide(UpvoteRepository.layer)
);
