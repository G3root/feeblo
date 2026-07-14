import { expect, layer } from "@effect/vitest";
import { Database } from "@feeblo/db";
import { PostId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { BoardRepository } from "../board/repository";
import { PostRpcHandlersEffect } from "./handlers";
import { PostPolicy } from "./policies";
import { PostRepository } from "./repository";
import { PostSubscriptionRepository } from "../post-subscription/repository";
import { BadRequestError } from "../rpc-errors";
import { CurrentSession, type Session } from "../session-middleware";

const session: Session = {
  user: {
    id: "user_1",
    email: "user@example.com",
    name: "Test User",
    restrictedToOrganizationId: null,
  },
  session: {
    userId: "user_1",
    token: "test-token",
  },
  organizations: [{ id: "org_1" }],
  memberships: [
    {
      membershipId: "membership_1",
      organizationId: "org_1",
      role: "owner",
    },
  ],
};

const RepositoriesTest = Layer.mergeAll(
  BoardRepository.layer,
  PostRepository.layer,
  PostSubscriptionRepository.layer
).pipe(Layer.provide(Database.PgliteDatabaseLive));

const HandlerTest = PostPolicy.layer.pipe(Layer.provideMerge(RepositoriesTest));

const TestLayer = HandlerTest;

layer(TestLayer)("PostRpcHandlers", (it) => {
  it.effect("rejects merging a post into itself", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const handlers = yield* PostRpcHandlersEffect;
        const organizationId = yield* WorkspaceId.generate;
        const postId = yield* PostId.generate;
        const error = yield* Effect.flip(
          handlers
            .PostMerge({
              organizationId,
              sourcePostId: postId,
              targetPostId: postId,
            })
            .pipe(
              Effect.provideService(CurrentSession, {
                ...session,
                organizations: [{ id: organizationId }],
                memberships: [
                  {
                    membershipId: "membership_1",
                    organizationId,
                    role: "owner",
                  },
                ],
              })
            )
        );

        expect(error).toBeInstanceOf(BadRequestError);
        expect(error.message).toBe("Source and target posts must be different");
      })
    )
  );
});
