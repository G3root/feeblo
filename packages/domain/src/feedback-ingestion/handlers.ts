import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Policy from "../policy";
import { PostRepository } from "../post/repository";
import { PostActivityRepository } from "../post-activity/repository";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { UpvoteRepository } from "../upvote/repository";
import { FeedbackIngestionRepository } from "./repository";
import { FeedbackIngestionRpcs } from "./rpcs";
import { FeedbackIngestionService, FeedbackTriageService } from "./service";

export const FeedbackIngestionRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* FeedbackIngestionRepository;
  const ingestion = yield* FeedbackIngestionService;
  const triage = yield* FeedbackTriageService;

  const withTriageActor = <A, E, R>(
    organizationId: string,
    run: (actor: {
      readonly actorId: string;
      readonly memberId: string;
    }) => Effect.Effect<A, E, R>
  ) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, organizationId);
      if (!membership) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Workspace membership is required",
        });
      }
      return yield* run({
        actorId: session.session.userId,
        memberId: membership.membershipId,
      });
    });

  return {
    FeedbackSimilarPostsPublic: (
      args: Parameters<typeof repository.findSimilarPosts>[0]
    ) =>
      repository
        .findSimilarPosts(args)
        .pipe(withRemapDbErrors("Feedback", "select")),

    FeedbackCapture: (args: Parameters<typeof ingestion.capture>[0]) =>
      ingestion
        .capture(args)
        .pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Feedback", "create")
        ),

    FeedbackTriageList: (
      args: Parameters<typeof repository.listTriageItems>[0]
    ) =>
      repository
        .listTriageItems(args)
        .pipe(
          Policy.withPolicy(
            Policy.hasOrganizationOwnerOrAdmin(args.organizationId)
          ),
          withRemapDbErrors("Feedback triage item", "select")
        ),

    FeedbackTriageCreatePost: (
      args: Omit<
        Parameters<typeof triage.createPost>[0],
        "actorId" | "memberId"
      >
    ) =>
      withTriageActor(args.organizationId, (actor) =>
        triage.createPost({ ...args, ...actor })
      ).pipe(
        Policy.withPolicy(
          Policy.hasOrganizationOwnerOrAdmin(args.organizationId)
        ),
        withRemapDbErrors("Feedback triage item", "update")
      ),

    FeedbackTriageLinkPost: (
      args: Omit<Parameters<typeof triage.linkPost>[0], "actorId" | "memberId">
    ) =>
      withTriageActor(args.organizationId, (actor) =>
        triage.linkPost({ ...args, ...actor })
      ).pipe(
        Policy.withPolicy(
          Policy.hasOrganizationOwnerOrAdmin(args.organizationId)
        ),
        withRemapDbErrors("Feedback triage item", "update")
      ),

    FeedbackTriageIgnore: (
      args: Omit<Parameters<typeof triage.ignore>[0], "memberId">
    ) =>
      withTriageActor(args.organizationId, ({ memberId }) =>
        triage.ignore({ ...args, memberId })
      ).pipe(
        Policy.withPolicy(
          Policy.hasOrganizationOwnerOrAdmin(args.organizationId)
        ),
        withRemapDbErrors("Feedback triage item", "update")
      ),
  };
});

const FeedbackRepositories = Layer.mergeAll(
  FeedbackIngestionRepository.layer,
  PostActivityRepository.layer,
  PostRepository.layer,
  UpvoteRepository.layer
);

const FeedbackServices = Layer.merge(
  FeedbackIngestionService.layer,
  FeedbackTriageService.layer
).pipe(Layer.provideMerge(FeedbackRepositories));

export const FeedbackIngestionRpcHandlers = FeedbackIngestionRpcs.toLayer(
  FeedbackIngestionRpcHandlersEffect
).pipe(Layer.provide(FeedbackServices));
