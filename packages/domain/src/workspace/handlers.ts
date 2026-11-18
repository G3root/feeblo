import { transaction } from "@feeblo/db";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { BadRequestError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { SubdomainValidationService } from "../site/subdomain/service";
import { WorkspacePolicy } from "./policies";
import { WorkspaceRepository } from "./repository";
import { WorkspaceRpcs } from "./rpcs";
import type {
  TCreateWorkspaceInput,
  TWorkspaceInput,
  TWorkspaceSlugCheckInput,
} from "./schema";

/** The longest board name the create accepts, matching the name fields. */
const MAX_BOARD_NAME_LENGTH = 60;

/**
 * The board names a create will write.
 *
 * Trimmed, with blanks and repeats dropped. `board.slug` is unique per
 * workspace, and two names that slugify to the same string would collide on
 * insert, so the first one wins and the second is dropped rather than failing
 * a create the reader cannot fix from the form.
 */
const normalizeBoardNames = (names: readonly string[]): string[] => {
  const bySlug = new Map<string, string>();

  for (const name of names) {
    const trimmed = name.trim();
    const slug = slugify(trimmed);

    if (slug.length === 0 || bySlug.has(slug)) {
      continue;
    }

    bySlug.set(slug, trimmed);
  }

  return [...bySlug.values()];
};

export const WorkspaceRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;
  const workspacePolicy = yield* WorkspacePolicy;
  const { validate: validateSubdomain } = yield* SubdomainValidationService;

  return {
    CreateWorkspace: (args: TCreateWorkspaceInput) => {
      return Effect.gen(function* () {
        // Deliberately not audited. An audit entry is scoped to the workspace
        // it describes, and there is no organization to write the row under
        // until this transaction commits — the caller is not a member yet, and
        // a row filed under any other workspace would be both misplaced and
        // outside this session's authority. The catalog agrees: `workspace`
        // declares `updated` and `deleted` only, because creation is the
        // moment the scope comes into existence. The owner membership row this
        // transaction writes is the durable record of who created it.
        const session = yield* CurrentSession;
        const workspaceName = args.workspaceName.trim();
        const subdomain = args.subdomain.trim().toLowerCase();

        // The schema already refuses a short subdomain, but the handlers are
        // also called directly (tests, and any future internal caller that
        // skips decoding), and a two-character address would pass every other
        // check in this function.
        if (subdomain.length < 4) {
          return yield* new BadRequestError({
            message: "Subdomain must be at least 4 characters",
          });
        }

        yield* validateSubdomain(subdomain);

        const boardNames = normalizeBoardNames(args.boardNames);
        const boardLimit = PLAN_ENTITLEMENTS.free.limits.feedbackBoards;

        if (boardNames.length === 0) {
          return yield* new BadRequestError({
            message: "A workspace needs at least one board",
          });
        }

        // A workspace is created on the free plan, so that allowance is the
        // ceiling here. Letting the request through would land the reader on a
        // workspace that is over its plan before they have seen it.
        if (boardLimit !== null && boardNames.length > boardLimit) {
          return yield* new BadRequestError({
            message: `A new workspace starts with at most ${boardLimit} boards`,
          });
        }

        const longName = boardNames.find(
          (name) => name.length > MAX_BOARD_NAME_LENGTH
        );

        if (longName !== undefined) {
          return yield* new BadRequestError({
            message: `Board names are ${MAX_BOARD_NAME_LENGTH} characters or fewer`,
          });
        }

        return yield* transaction(
          Effect.gen(function* () {
            // Lock first, then count: the per-user workspace cap spans
            // workspaces, so the count is only authoritative while this row
            // is held. Locking before the first child insert avoids
            // deadlocking two concurrent creates against each other.
            yield* repository.lockUser(session.session.userId);
            yield* workspacePolicy.canCreateWorkspace({
              userId: session.session.userId,
            });

            const isSubdomainTaken =
              yield* repository.isSubdomainTaken(subdomain);

            if (isSubdomainTaken) {
              return yield* new BadRequestError({
                message: "This workspace name is already taken",
              });
            }

            // Read under the same lock, and before the insert: "first" is a
            // property of the world before this workspace, and a count taken
            // after the commit would race a concurrent create.
            const owned = yield* repository.findOwnedWorkspaces(
              session.session.userId
            );

            const organizationId = yield* repository.createWorkspace({
              boardNames,
              subdomain,
              userId: session.session.userId,
              workspaceName,
            });

            return { isFirstWorkspace: owned.length === 0, organizationId };
          })
        );
      }).pipe(withRemapDbErrors("Workspace", "create"));
    },
    GetWorkspaceCreationState: () =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;

        return yield* workspacePolicy.getCreationState({
          userId: session.session.userId,
        });
      }).pipe(withRemapDbErrors("Workspace", "select")),
    GetWorkspaceOnboardingSummary: (args: TWorkspaceInput) =>
      Effect.gen(function* () {
        const samplePostCount = yield* repository.countOnboardingPosts(
          args.organizationId
        );

        return { samplePostCount };
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Workspace", "select")
      ),
    ListWorkspaceProducts: () =>
      repository.findProducts().pipe(withRemapDbErrors("Workspace", "select")),
    GetWorkspacePlan: (args: TWorkspaceInput) =>
      repository
        .findPlanByOrganizationId({
          organizationId: args.organizationId,
        })
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Workspace", "select")
        ),
    CheckWorkspaceSlug: (args: TWorkspaceSlugCheckInput) =>
      validateSubdomain(args.slug).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.succeed({
              available: false,
              suggestion: null,
              reason: error.message,
            }),
          onSuccess: () =>
            Effect.gen(function* () {
              const taken = yield* repository.isSubdomainTaken(args.slug);

              if (!taken) {
                return {
                  available: true,
                  suggestion: null,
                  reason: null,
                };
              }

              const suggestion = yield* repository.getSubdomainSuggestion(
                args.slug
              );

              return {
                available: false,
                suggestion: Option.getOrNull(suggestion),
                reason: "This workspace name is already taken",
              };
            }),
        }),
        withRemapDbErrors("Workspace", "select")
      ),
  };
});

export const WorkspaceRpcHandlers = WorkspaceRpcs.toLayer(
  WorkspaceRpcHandlersEffect
).pipe(
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(WorkspacePolicy.layer),
  Layer.provide(SubdomainValidationService.layerEnv)
);
