import { ContactSource } from "@feeblo/db/validation-schema/entity-source";
import {
  ContactAttributeDefinitionId,
  ContactAttributeValueId,
  ContactId,
  WorkspaceId,
} from "@feeblo/id";
import * as S from "effect/Schema";

import { noDuplicateAttributeIds } from "../attribute-definition/validation";

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
          S.Union([S.String, S.Finite, S.Boolean, S.DateFromString])
        ),
      })
    ).check(noDuplicateAttributeIds)
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

/**
 * Whether the workspace's plan has room for one more CRM entry. The picker
 * asks before it offers the create-new-customer row; the write path still
 * enforces the cap inside its transaction, so this answers the UI alone.
 */
export const ContactCreateEligibility = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TContactCreateEligibility = S.Schema.Type<
  typeof ContactCreateEligibility
>;

/**
 * Stops every email subscription the customer's address holds in the
 * workspace. Separate from delete on purpose: removing a customer from the
 * CRM and withdrawing their email consent are different decisions.
 */
export const ContactUnsubscribe = S.Struct({
  id: ContactId.schema,
  organizationId: WorkspaceId.schema,
});

export type TContactUnsubscribe = S.Schema.Type<typeof ContactUnsubscribe>;

export const ContactSearch = S.Struct({
  organizationId: WorkspaceId.schema,
  query: S.String,
  postId: S.optional(S.String),
  limit: S.optional(
    S.Int.check(
      S.isBetween({
        minimum: 1,
        maximum: 25,
      })
    )
  ),
});

export const ContactSearchResult = S.Struct({
  // Null for organization members surfaced without a contact row: members
  // are staff, never contacts. Submit paths resolve via userId.
  contactId: S.NullOr(S.String),
  userId: S.NullOr(S.String),
  name: S.NullOr(S.String),
  email: S.NullOr(S.String),
  avatarUrl: S.NullOr(S.String),
  companyName: S.NullOr(S.String),
  isMember: S.Boolean,
  hasAccess: S.Boolean,
  alreadyVoted: S.Boolean,
});

export type TContactCreate = S.Schema.Type<typeof ContactCreate>;
export type TContactUpdate = S.Schema.Type<typeof ContactUpdate>;
export type TContactDelete = S.Schema.Type<typeof ContactDelete>;
export type TContactSearch = S.Schema.Type<typeof ContactSearch>;
export type TContactSearchResult = S.Schema.Type<typeof ContactSearchResult>;

/**
 * What kind of account a contact is linked to, when one is linked at all.
 *
 * - `MEMBER`: the account is a member of this workspace (staff, not a
 *   customer; an old contact row for them still counts against the plan).
 * - `PORTAL`: an SSO portal account bound to this workspace.
 * - `ACCOUNT`: a real, unrestricted Feeblo account.
 * - `SHADOW`: an attribution-only `behalf-*` account that cannot sign in.
 */
export const ContactAccountKind = S.Literals([
  "MEMBER",
  "PORTAL",
  "ACCOUNT",
  "SHADOW",
]);

/**
 * Whether the linked account can be emailed post updates today.
 *
 * `PUBLIC_ONLY` is the honest answer for an unrestricted account on the CRM
 * page, where no post (and so no board visibility) is in hand: the delivery
 * gate passes them only for posts on public boards.
 */
export const ContactNotifyAccess = S.Literals(["YES", "PUBLIC_ONLY", "NO"]);

export type TContactAccountKind = S.Schema.Type<typeof ContactAccountKind>;
export type TContactNotifyAccess = S.Schema.Type<typeof ContactNotifyAccess>;

export const Contact = S.Struct({
  id: S.String,
  organizationId: S.String,
  externalId: S.NullOr(S.String),
  email: S.NullOr(S.String),
  name: S.NullOr(S.String),
  phone: S.NullOr(S.String),
  avatar: S.NullOr(S.String),
  companyId: S.NullOr(S.String),
  /** Linked feeblo account, when the customer has (or was provisioned) one. */
  userId: S.optional(S.NullOr(S.String)),
  source: ContactSource,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type TContact = S.Schema.Type<typeof Contact>;

/**
 * The `ListContacts` row: the contact plus the state of its linked account.
 * Write responses (`CreateContact` / `UpdateContact`) are the stored `Contact`
 * row and do not carry the two derived fields; the account state is classified
 * per read in `contact/repository.ts#findManyContacts`, from the same
 * `evaluateOrganizationAccess` the delivery gate uses.
 */
export const ContactWithAccount = S.Struct({
  ...Contact.fields,
  /**
   * What the linked account is, for the Customers table and the delete
   * confirmation. `null` when no account is linked.
   */
  accountKind: S.NullOr(ContactAccountKind),
  /** Whether the linked account can receive post updates. See the literal. */
  notifyAccess: ContactNotifyAccess,
});

export type TContactWithAccount = S.Schema.Type<typeof ContactWithAccount>;

export const ContactList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TContactList = S.Schema.Type<typeof ContactList>;
