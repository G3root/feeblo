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
  ) =>
    Policy.policy(() => repository.contactAttributeDefinitionExists(args));

  const companyBelongsToOrganization = (
    args: TCompanyAttributeDefinitionDelete
  ) =>
    Policy.policy(() => repository.companyAttributeDefinitionExists(args));

  const canCreateContact = (organizationId: string) =>
    Policy.hasMembership(organizationId);

  const canUpdateContact = (args: TContactAttributeDefinitionDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      contactBelongsToOrganization(args)
    );

  const canDeleteContact = canUpdateContact;

  const canCreateCompany = (organizationId: string) =>
    Policy.hasMembership(organizationId);

  const canUpdateCompany = (args: TCompanyAttributeDefinitionDelete) =>
    Policy.all(
      Policy.hasMembership(args.organizationId),
      companyBelongsToOrganization(args)
    );

  const canDeleteCompany = canUpdateCompany;

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
