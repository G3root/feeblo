import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { UpvotePolicy } from "./policies";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type { TUpvoteList, TUpvoteToggle } from "./schema";

export const UpvoteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UpvoteRepository;
  const upvotePolicy = yield* UpvotePolicy;
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
        const result = yield* transaction(
          repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
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
      Effect.gen(function* () {
        const sessionOption = yield* OptionalCurrentSession;
        const sessionUserId =
          sessionOption._tag === "Some"
            ? sessionOption.value.session.userId
            : undefined;

        const upvotes = yield* repository.list({
          organizationId: args.organizationId,
          publicOnly: true,
          ...(args.postId ? { postId: args.postId } : {}),
        });

        // Never leak internal voter identifiers to public callers.
        return redactActorIdentities(upvotes, sessionUserId);
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "UpvoteListPublic",
          level: "read",
        }),
        withRemapDbErrors("Upvote", "select")
      ),
    UpvoteTogglePublic: (args: TUpvoteToggle) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        //TODO: comeback later
        // yield* sitePolicy.canViewRoadmap(args.organizationId);

        const result = yield* transaction(
          repository.toggle({
            organizationId: args.organizationId,
            postId: args.postId,
            userId: session.session.userId,
          })
        );

        return result;
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "UpvoteTogglePublic",
          level: "write",
        }),
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
  Layer.provide(UpvoteRepository.layer)
);
