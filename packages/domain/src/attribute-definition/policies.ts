import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { AttributeDefinitionRepository } from "./repository";
import type {
  TCompanyAttributeDefinitionDelete,
  TContactAttributeDefinitionDelete,
} from "./schema";

const makeAttributeDefinitionPolicy = Effect.gen(function* () {
  const repository = yield* AttributeDefinitionRepository;
  const entitlementPolicy = yield* EntitlementPolicy;

  const contactBelongsToOrganization = (
    args: TContactAttributeDefinitionDelete
  ) => Policy.policy(() => repository.contactAttributeDefinitionExists(args));

  const companyBelongsToOrganization = (
    args: TCompanyAttributeDefinitionDelete
  ) => Policy.policy(() => repository.companyAttributeDefinitionExists(args));

  const canCreateContact = (organizationId: string) =>
    Policy.all(
      Policy.canPermission(organizationId, "contacts.*"),
      entitlementPolicy.assertWorkspaceWritable(organizationId)
    );

  const canUpdateContact = (args: TContactAttributeDefinitionDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "contacts.*"),
      entitlementPolicy.assertWorkspaceWritable(args.organizationId),
      contactBelongsToOrganization(args)
    );

  // Deleting a definition is cleanup: a locked workspace stays able to reduce
  // its own attribute surface, so this deliberately omits the workspace check.
  const canDeleteContact = (args: TContactAttributeDefinitionDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "contacts.*"),
      contactBelongsToOrganization(args)
    );

  const canCreateCompany = (organizationId: string) =>
    Policy.all(
      Policy.canPermission(organizationId, "companies.*"),
      entitlementPolicy.assertWorkspaceWritable(organizationId)
    );

  const canUpdateCompany = (args: TCompanyAttributeDefinitionDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.*"),
      entitlementPolicy.assertWorkspaceWritable(args.organizationId),
      companyBelongsToOrganization(args)
    );

  const canDeleteCompany = (args: TCompanyAttributeDefinitionDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.*"),
      companyBelongsToOrganization(args)
    );

  return {
    contactBelongsToOrganization,
    companyBelongsToOrganization,
    canCreateContact,
    canUpdateContact,
    canDeleteContact,
    canCreateCompany,
    canUpdateCompany,
    canDeleteCompany,
  };
});

export class AttributeDefinitionPolicy extends Context.Service<AttributeDefinitionPolicy>()(
  "AttributeDefinitionPolicy",
  { make: makeAttributeDefinitionPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
