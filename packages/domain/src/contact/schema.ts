import {
  ContactAttributeDefinitionId,
  ContactAttributeValueId,
  ContactId,
  WorkspaceId,
} from "@feeblo/id";
import * as S from "effect/Schema";

export const CommonContactFields = S.Struct({
  userId: S.String,
  email: S.String,
  name: S.String,
  avatar: S.optional(S.String),
});

export type TCommonContactFields = S.Schema.Type<typeof CommonContactFields>;

export const ContactUpsert = S.Struct({
  organizationId: S.String,
  externalId: S.optional(S.String),
  email: S.optional(S.String),
  name: S.optional(S.String),
  phone: S.optional(S.String),
  avatar: S.optional(S.String),
  companyId: S.optional(S.NullOr(S.String)),
  userId: S.optional(S.NullOr(S.String)),
});

export type TContactUpsert = S.Schema.Type<typeof ContactUpsert>;

export const ContactCreate = S.Struct({
  id: S.optional(ContactId.schema),
  organizationId: WorkspaceId.schema,
  externalId: S.optional(S.NullOr(S.String)),
  email: S.optional(S.NullOr(S.String)),
  name: S.optional(S.NullOr(S.String)),
  phone: S.optional(S.NullOr(S.String)),
  avatar: S.optional(S.NullOr(S.String)),
  companyId: S.optional(S.NullOr(S.String)),
  userId: S.optional(S.NullOr(S.String)),
  attributeValues: S.optional(
    S.Array(
      S.Struct({
        id: S.optional(ContactAttributeValueId.schema),
        attributeId: ContactAttributeDefinitionId.schema,
        value: S.NullOr(
          S.Union([S.String, S.Number, S.Boolean, S.DateFromString])
        ),
      })
    )
  ),
});

export const ContactUpdate = S.Struct({
  id: ContactId.schema,
  organizationId: WorkspaceId.schema,
  externalId: S.optional(S.NullOr(S.String)),
  email: S.optional(S.NullOr(S.String)),
  name: S.optional(S.NullOr(S.String)),
  phone: S.optional(S.NullOr(S.String)),
  avatar: S.optional(S.NullOr(S.String)),
  companyId: S.optional(S.NullOr(S.String)),
  userId: S.optional(S.NullOr(S.String)),
});

export const ContactDelete = S.Struct({
  id: ContactId.schema,
  organizationId: WorkspaceId.schema,
});

export type TContactCreate = S.Schema.Type<typeof ContactCreate>;
export type TContactUpdate = S.Schema.Type<typeof ContactUpdate>;
export type TContactDelete = S.Schema.Type<typeof ContactDelete>;

export const Contact = S.Struct({
  id: S.String,
  organizationId: S.String,
  externalId: S.NullOr(S.String),
  email: S.NullOr(S.String),
  name: S.NullOr(S.String),
  phone: S.NullOr(S.String),
  avatar: S.NullOr(S.String),
  companyId: S.NullOr(S.String),
  source: S.Literals(["DASHBOARD", "WIDGET", "API", "IMPORT"]),
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TContact = S.Schema.Type<typeof Contact>;

export const ContactList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TContactList = S.Schema.Type<typeof ContactList>;
