import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EmailSubscriptionRepository } from "../email-subscription/repository";
import { ResolvePrincipalService } from "../identity/service";
import * as Policy from "../policy";
import { PostActivityRepository } from "../post-activity/repository";
import { PostRepository } from "../post/repository";
import { redactActorIdentities } from "../public-actor";
import { withPublicViewer } from "../public-read";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import { type Surface, definePublicEntry, defineSurfacePair } from "../surface";
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

/** The RPCs this group declares; a surface pair's operation must be one. */
type UpvoteRpcTag = RpcTagsOf<typeof UpvoteRpcs>;

export const UpvoteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* UpvoteRepository;
  const upvotePolicy = yield* UpvotePolicy;

  // -- Surface-parameterized writes --
  //
  // The policy's `source` selects the visibility rule: the dashboard checks
  // `isUnlocked`, the public portal `isUnlockedPublic`. The pair passes its
  // own surface to the factory, so the halves cannot disagree about which
  // rule is which.

  const canToggleFor = (args: TUpvoteToggle, surface: Surface) =>
    upvotePolicy.canToggle({
      organizationId: args.organizationId,
      postId: args.postId,
      source: surface,
    });

  const toggleWrite = defineSurfacePair<TUpvoteToggle, UpvoteRpcTag>()({
    operation: "ToggleUpvote",
    remap: { action: "update", entity: "Upvote" },
    dashboard: { rateLimit: undefined, policy: canToggleFor },
    public: { rateLimit: "write", policy: canToggleFor },
  });

  const toggleVote = toggleWrite.handlers((_surface, args) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;

      return yield* transaction(
        repository.toggle({
          organizationId: args.organizationId,
          postId: args.postId,
          userId: session.session.userId,
        })
      );
    })
  );

  // The dashboard list is the voter roster; the public list is filtered to
  // public-only rows with no roster, so the pair does not apply and the
  // dashboard half stays hand-written.
  const listPublicEntry = definePublicEntry<TUpvoteList, UpvoteRpcTag>()({
    operation: "ListUpvotes",
    remap: { action: "select", entity: "Upvote" },
    config: { rateLimit: "read", policy: () => Policy.allow },
  });

  return {
    ListUpvotes: (args: TUpvoteList) =>
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
    ToggleUpvote: toggleVote.dashboard,
    AddUpvoteOnBehalf: (args: TUpvoteAddOnBehalf) =>
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
    RemoveUpvoteOnBehalf: (args: TUpvoteRemoveOnBehalf) =>
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
    ListUpvotesPublic: listPublicEntry.entry((args) =>
      withPublicViewer({
        read: () =>
          repository.list({
            organizationId: args.organizationId,
            publicOnly: true,
            ...(args.postId && { postId: args.postId }),
            ...(args.slug && { slug: args.slug }),
          }),
        redact: redactActorIdentities,
      })
    ),
    ToggleUpvotePublic: toggleVote.public,
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
