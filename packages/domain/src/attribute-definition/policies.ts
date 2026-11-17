import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { AttributeDefinitionRepository } from "./repository";
import type {
  TCompanyAttributeDefinitionDelete,
  TContactAttributeDefinitionDelete,
} from "./schema";

const makeAttributeDefinitionPolicy = Effect.gen(function* () {
  const repository = yield* AttributeDefinitionRepository;

  const contactBelongsToOrganization = (
    args: TContactAttributeDefinitionDelete
  ) => Policy.policy(() => repository.contactAttributeDefinitionExists(args));

  const companyBelongsToOrganization = (
    args: TCompanyAttributeDefinitionDelete
  ) => Policy.policy(() => repository.companyAttributeDefinitionExists(args));

  const canCreateContact = (organizationId: string) =>
    Policy.canPermission(organizationId, "contacts.*");

  const canUpdateContact = (args: TContactAttributeDefinitionDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "contacts.*"),
      contactBelongsToOrganization(args)
    );

  const canCreateCompany = (organizationId: string) =>
    Policy.canPermission(organizationId, "companies.*");

  const canUpdateCompany = (args: TCompanyAttributeDefinitionDelete) =>
    Policy.all(
      Policy.canPermission(args.organizationId, "companies.*"),
      companyBelongsToOrganization(args)
    );

  return {
    contactBelongsToOrganization,
    companyBelongsToOrganization,
    canCreateContact,
    canUpdateContact,
    /** Deleting an attribute definition needs the same access as updating it. */
    canDeleteContact: canUpdateContact,
    canCreateCompany,
    canUpdateCompany,
    /** Deleting an attribute definition needs the same access as updating it. */
    canDeleteCompany: canUpdateCompany,
  };
});

export class AttributeDefinitionPolicy extends Context.Service<AttributeDefinitionPolicy>()(
  "AttributeDefinitionPolicy",
  { make: makeAttributeDefinitionPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
