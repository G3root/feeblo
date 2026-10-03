import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { ResolvePrincipalService } from "../identity/service";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession, OptionalCurrentSession } from "../session-middleware";
import { UserRepository } from "../user/repository";
import { addVoteOnBehalf, removeVoteOnBehalf } from "./on-behalf";
import { UpvotePolicy } from "./policies";
import { UpvoteRepository } from "./repository";
import { UpvoteRpcs } from "./rpcs";
import type {
  TUpvoteAddOnBehalf,
  TUpvoteList,
  TUpvoteRemoveOnBehalf,
  TUpvoteToggle,
} from "./schema";

export const UpvoteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UpvoteRepository;
  const upvotePolicy = yield* UpvotePolicy;

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
    UpvoteAddOnBehalf: (args: TUpvoteAddOnBehalf) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        // Per-member abuse bound for on-behalf voter management (see
        // plan-on-behalf.md).
        yield* RateLimit.consumeOnBehalfWriteLimit({
          organizationId: args.organizationId,
          userId: session.session.userId,
        });

        // The resolution, the idempotent insert, the timeline entry, and the
        // voter subscription are the shared on-behalf path, so the Public
        // API's `createVote` performs exactly this and cannot drift.
        const result = yield* addVoteOnBehalf({
          actor: {
            userId: session.session.userId,
            memberId: membership?.membershipId ?? null,
          },
          organizationId: args.organizationId,
          postId: args.postId,
          subject: args.author,
        });

        return { added: result.added };
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canVoteOnBehalf({
            organizationId: args.organizationId,
            postId: args.postId,
          })
        ),
        withRemapDbErrors("Upvote", "update")
      ),
    UpvoteRemoveOnBehalf: (args: TUpvoteRemoveOnBehalf) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const membership = Policy.getMembership(session, args.organizationId);
        // Same per-member bound as the add path (see plan-on-behalf.md).
        yield* RateLimit.consumeOnBehalfWriteLimit({
          organizationId: args.organizationId,
          userId: session.session.userId,
        });

        return yield* removeVoteOnBehalf({
          actor: {
            userId: session.session.userId,
            memberId: membership?.membershipId ?? null,
          },
          organizationId: args.organizationId,
          postId: args.postId,
          userId: args.userId,
        });
      }).pipe(
        Policy.withPolicy(
          upvotePolicy.canVoteOnBehalf({
            organizationId: args.organizationId,
            postId: args.postId,
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
          ...(args.postId && { postId: args.postId }),
          ...(args.slug && { slug: args.slug }),
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
        // Public visibility is enforced via `upvotePolicy.canToggle` with
        // `source: "public"` (which checks `isUnlockedPublic` internally).
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
  Layer.provide(UpvoteRepository.layer),
  Layer.provide(PostActivityRepository.layer),
  Layer.provide(EmailSubscriptionRepository.layer),
  Layer.provide(ResolvePrincipalService.layer),
  Layer.provide(UserRepository.layer)
);
