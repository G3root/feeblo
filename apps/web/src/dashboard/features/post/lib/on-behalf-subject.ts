import type { TPostActivity } from "@feeblo/domain/post-activity/schema";

/** The only contact fields the subject label reads. */
export type OnBehalfContact = {
  readonly email: string | null;
  readonly name: string | null;
};

/** The only member fields the subject label reads. */
export type OnBehalfMember = {
  readonly user: { readonly name: string };
};

/**
 * Provenance payload recorded by on-behalf actions
 * (`packages/domain/src/post-activity/repository.ts#PostActivityMetadata`).
 * `ListPostActivities` returns `metadata` (nullable; null for every
 * pre-on-behalf row). Newer rows also carry the subject's `name` / `email`
 * snapshot and `kind`, which is what keeps the timeline readable after the
 * contact or member is deleted.
 */
export type OnBehalfMetadata = {
  onBehalfOf?: {
    contactId?: string | null;
    userId?: string | null;
    name?: string | null;
    email?: string | null;
    kind?: "member" | "customer" | null;
  } | null;
};

export function getOnBehalfMetadata(
  activity: TPostActivity
): OnBehalfMetadata | null {
  // Metadata is decoded by the PostActivity RPC schema; absent for every
  // pre-on-behalf activity row.
  const onBehalfOf = activity.metadata?.onBehalfOf ?? null;
  if (!onBehalfOf) {
    return null;
  }
  return { onBehalfOf };
}

/**
 * The label rendered after "on behalf of": the subject's display name and
 * whether it came from the member list rather than the customer list.
 */
export type OnBehalfSubjectLabel = {
  readonly isMember: boolean;
  readonly name: string;
};

/**
 * The subject of an on-behalf activity, resolved from the provenance
 * metadata: a customer contact, or a workspace member when the subject is
 * staff (staff attribution records no contact id).
 *
 * The live contact/member list wins so a rename shows up on old entries. The
 * snapshot taken at write time is the fallback, and it matters: deleting the
 * contact or removing the member used to collapse every such entry to
 * "a customer" even though the entry still recorded who it was written for.
 */
export function resolveOnBehalfSubject(
  metadata: OnBehalfMetadata,
  contactsById: ReadonlyMap<string, OnBehalfContact>,
  contactsByUserId: ReadonlyMap<string, OnBehalfContact>,
  membersByUserId: ReadonlyMap<string, OnBehalfMember>
): OnBehalfSubjectLabel {
  const contactId = metadata.onBehalfOf?.contactId;
  const userId = metadata.onBehalfOf?.userId;
  const contact =
    (contactId ? contactsById.get(contactId) : undefined) ??
    (userId ? contactsByUserId.get(userId) : undefined);
  if (contact) {
    return {
      name: contact.name ?? contact.email ?? "a customer",
      isMember: false,
    };
  }

  const member = userId ? membersByUserId.get(userId) : undefined;
  if (member) {
    return { name: member.user.name, isMember: true };
  }

  // Neither the contact nor the member resolves any more. Fall back to the
  // identity captured when the action was recorded.
  const snapshot = metadata.onBehalfOf?.name ?? metadata.onBehalfOf?.email;
  const wasMember = metadata.onBehalfOf?.kind === "member";
  if (snapshot) {
    return { name: snapshot, isMember: wasMember };
  }

  return {
    name: wasMember ? "a workspace member" : "a customer",
    isMember: wasMember,
  };
}
