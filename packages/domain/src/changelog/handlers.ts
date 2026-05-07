import { Effect, Layer } from "effect";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { sanitizeRichText } from "../sanitize-html";
import { CurrentSession } from "../session-middleware";
import { SitePolicy } from "../site/policies";
import { SiteRepository } from "../site/repository";
import { WorkspaceRepository } from "../workspace/repository";
import { ChangelogPolicy } from "./policies";
import { ChangelogRepository } from "./repository";
import { ChangelogRpcs } from "./rpcs";
import type {
  TChangelogCreate,
  TChangelogDelete,
  TChangelogList,
  TChangelogUpdate,
} from "./schema";

export const ChangelogRpcHandlers = ChangelogRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* ChangelogRepository;
    const changelogPolicy = yield* ChangelogPolicy;
    const sitePolicy = yield* SitePolicy;

    return {
      ChangelogList: (args: TChangelogList) =>
        repository
          .findMany(args)
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Changelog", "select")
          ),

      ChangelogListPublic: (args: TChangelogList) =>
        Effect.gen(function* () {
          return yield* repository.findManyPublished(args);
        }).pipe(
          Policy.withPolicy(sitePolicy.canViewChangelog(args.organizationId)),
          withRemapDbErrors("Changelog", "select")
        ),

      ChangelogCreate: (args: TChangelogCreate) => {
        return Effect.gen(function* () {
          const session = yield* CurrentSession;
          const isMember = Policy.getMembership(session, args.organizationId);

          yield* repository.create({
            ...args,
            content: sanitizeRichText(args.content),
            creatorId: session.session.userId,
            ...(isMember ? { creatorMemberId: isMember.membershipId } : {}),
          });
        }).pipe(
          Policy.withPolicy(Policy.hasMembership(args.organizationId)),
          withRemapDbErrors("Changelog", "create")
        );
      },

      ChangelogDelete: (args: TChangelogDelete) =>
        repository.delete(args).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              changelogPolicy.isOwner({
                organizationId: args.organizationId,
                changelogId: args.id,
              })
            )
          ),
          withRemapDbErrors("Changelog", "delete")
        ),

      ChangelogUpdate: (args: TChangelogUpdate) =>
        repository
          .update({
            ...args,
            content: sanitizeRichText(args.content),
          })
          .pipe(
            Policy.withPolicy(
              Policy.all(
                Policy.hasMembership(args.organizationId),
                changelogPolicy.isOwner({
                  organizationId: args.organizationId,
                  changelogId: args.id,
                })
              )
            ),
            withRemapDbErrors("Changelog", "update")
          ),
    };
  })
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(ChangelogPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer),
  Layer.provide(ChangelogRepository.layer)
);
