import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { RoadmapRepository } from "./repository";

type TCanCreate = {
  organizationId: string;
  visibility: "public" | "private";
};

type TCanDelete = {
  organizationId: string;
};

type TCanUpdate = {
  organizationId: string;
  roadmapId: string;
  visibility: "public" | "private";
};

const makeRoadmapPolicy = Effect.gen(function* () {
  const repository = yield* RoadmapRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const canCreate = (args: TCanCreate) =>
    Policy.all(
      Policy.hasOrganizationOwnerOrAdmin(args.organizationId),
      entitlementPolicy.canCreateRoadmap(args)
    );

  const canDelete = (args: TCanDelete) =>
    Policy.hasOrganizationOwnerOrAdmin(args.organizationId);

  const canUpdate = (args: TCanUpdate) =>
    Policy.all(
      Policy.hasOrganizationOwnerOrAdmin(args.organizationId),
      Effect.gen(function* () {
        if (args.visibility !== "private") {
          return;
        }

        const roadmap = yield* repository.getById({
          id: args.roadmapId,
          organizationId: args.organizationId,
        });

        if (Option.isSome(roadmap) && roadmap.value.visibility === "private") {
          return;
        }

        yield* entitlementPolicy.canUpdateRoadmapVisibility({
          organizationId: args.organizationId,
        });
      })
    );

  return { canCreate, canDelete, canUpdate };
});

export class RoadmapPolicy extends Context.Service<RoadmapPolicy>()(
  "RoadmapPolicy",
  {
    make: makeRoadmapPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}
