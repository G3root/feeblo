import type { ReactionEmoji } from "@feeblo/utils/reaction";
import * as Effect from "effect/Effect";

import * as Policy from "../policy";
import { PostPolicy } from "../post/policies";
import { type ActorRow, redactActorIdentities } from "../public-actor";
import { withPublicViewer } from "../public-read";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import {
  definePublicEntry,
  type PairedRpcTag,
  defineSurfacePair,
} from "../surface";

/**
 * What every reaction toggle carries, whichever entity it reacts to.
 *
 * The parent post is part of it for both targets: the comment toggle needs it
 * to check the post's lock and board visibility, and the post toggle is about
 * that post. A target with no post above it is not a reaction this family
 * describes.
 */
export interface ReactionToggleInput {
  readonly organizationId: string;
  readonly postId: string;
  readonly emoji: ReactionEmoji;
}

/**
 * One target's reaction boundary, as the shared handler factory reads it.
 *
 * The four methods are the whole surface: a list per audience and a toggle per
 * audience. The repositories already own the queries, the merged-content rules,
 * and the insert-or-delete semantics; what this contract fixes is the *shape*
 * the two targets agree on, so the authorization, the rate-limit levels, the
 * public redaction, and the db-error remap below cannot be written once per
 * target and drift apart.
 */
export interface ReactionServiceContract<
  TList,
  TToggle extends ReactionToggleInput,
  Row extends ActorRow,
  E,
> {
  /** The dashboard projection: unpublished and merged content included. */
  readonly list: (input: TList) => Effect.Effect<readonly Row[], E>;
  /** The portal projection: public board, public comments, unmerged only. */
  readonly listPublic: (input: TList) => Effect.Effect<readonly Row[], E>;
  /** Toggles one emoji for one user; a second identical toggle removes it. */
  readonly toggle: (
    input: TToggle & { readonly userId: string }
  ) => Effect.Effect<ReactionToggleOutcome, E>;
  /** The same toggle, reached unauthenticated and joined to board visibility. */
  readonly togglePublic: (
    input: TToggle & { readonly userId: string }
  ) => Effect.Effect<ReactionToggleOutcome, E>;
}

/** What a toggle answers; mirrors `ReactionToggleResult` without the schema. */
export interface ReactionToggleOutcome {
  readonly emoji: ReactionEmoji | null;
  readonly reacted: boolean;
}

/**
 * The four RPC handlers every reaction target publishes.
 *
 * Both targets declare their own RPC group — the names are the contract, and
 * `ListPostReactions` is not `ListCommentReactions` — but the handlers behind
 * them are the same four operations in the same order, so they are built here
 * from one declaration and the target's `handlers.ts` is only the mapping onto
 * its own method names.
 *
 * The two surfaces differ in exactly two places, and both are properties of the
 * pair rather than of the target: the dashboard checks membership and the
 * post's lock, while the portal checks the restricted-organization scope and
 * the *public* lock, and it lists through the public projection and redacts
 * every other user's identifiers.
 */
export const makeReactionRpcHandlers =
  <
    Tags extends string,
    TList extends { readonly organizationId: string; readonly slug: string },
    TToggle extends ReactionToggleInput,
  >() =>
  <Row extends ActorRow, E>(args: {
    /** The entity name the db-error remap reports, e.g. `"PostReaction"`. */
    readonly entity: string;
    /** The dashboard list RPC; its `Public` twin is what the portal answers. */
    readonly listOperation: PairedRpcTag<Tags>;
    readonly toggleOperation: PairedRpcTag<Tags>;
    readonly service: ReactionServiceContract<TList, TToggle, Row, E>;
  }) =>
    Effect.gen(function* () {
      const postPolicy = yield* PostPolicy;

      // The pair carries the two surfaces' policies, limiters, and bucket names,
      // so a target cannot answer with another surface's authorization.
      const toggleWrite = defineSurfacePair<TToggle, Tags>()({
        operation: args.toggleOperation,
        remap: { action: "update", entity: args.entity },
        dashboard: {
          rateLimit: undefined,
          policy: (input: TToggle) =>
            Policy.all(
              Policy.hasMembership(input.organizationId),
              postPolicy.isUnlocked({
                organizationId: input.organizationId,
                postId: input.postId,
              })
            ),
        },
        public: {
          rateLimit: "write",
          policy: (input: TToggle) =>
            Policy.all(
              Policy.hasRestrictedOrganizationScope(input.organizationId),
              postPolicy.isUnlockedPublic({
                organizationId: input.organizationId,
                postId: input.postId,
              })
            ),
        },
      });

      // The list halves do not pair: each surface projects its own rows, so the
      // dashboard read is written here and the portal read is the public entry.
      const listPublicEntry = definePublicEntry<TList, Tags>()({
        operation: args.listOperation,
        remap: { action: "select", entity: args.entity },
        config: { rateLimit: "read", policy: () => Policy.allow },
      });

      const toggleReaction = toggleWrite.handlers((surface, input) =>
        Effect.gen(function* () {
          const session = yield* CurrentSession;
          const request = {
            ...input,
            userId: session.session.userId,
          };

          return yield* surface === "public"
            ? args.service.togglePublic(request)
            : args.service.toggle(request);
        })
      );

      return {
        list: (input: TList) =>
          args.service
            .list(input)
            .pipe(
              Policy.withPolicy(Policy.hasMembership(input.organizationId)),
              withRemapDbErrors(args.entity, "select")
            ),
        toggle: toggleReaction.dashboard,
        listPublic: listPublicEntry.entry((input: TList) =>
          withPublicViewer({
            read: () => args.service.listPublic(input),
            redact: redactActorIdentities,
          })
        ),
        togglePublic: toggleReaction.public,
      };
    });
