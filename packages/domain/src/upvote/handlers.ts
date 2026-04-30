import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type { TUpvoteList, TUpvoteToggle } from "./schema";

export const UpvoteRpcHandlers = UpvoteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* UpvoteRepository;
    // const sitePolicy = yield* SitePolicy;

    return {
      UpvoteList: (args: TUpvoteList) =>
        Effect.gen(function* () {
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
                  message: "Failed to list upvotes",
                })
              ),
          })
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
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle upvote",
                })
              ),
          })
        ),
      UpvoteListPublic: (args: TUpvoteList) =>
        Effect.gen(function* () {
          //TODO: comeback later
          // yield* sitePolicy.canViewRoadmap(args.organizationId);
          return yield* repository.list({
            postId: args.postId,
            organizationId: args.organizationId,
          });
        }).pipe(
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to list upvotes",
                })
              ),
          })
        ),
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
          Effect.catchTags({
            SqlError: () =>
              Effect.fail(
                new InternalServerError({
                  message: "Failed to toggle upvote",
                })
              ),
          })
        ),
    };
  })
).pipe(Layer.provide(UpvoteRepository.layer));
