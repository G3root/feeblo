import * as Atom from "effect/unstable/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/**
 * API-key state is Effect Atom, not a TanStack DB collection.
 *
 * Collections in this dashboard carry entity data the UI edits optimistically
 * (posts, comments, votes, reactions). Machine credentials are the opposite:
 * every change is server-authoritative, revocation is destructive and must
 * never *look* applied while a request is in flight, and the create response
 * carries a secret that must be shown once and never cached in a client store.
 * The webhook endpoints page — the closest analogue, an org-scoped credential
 * list with a one-time secret — is built the same way for the same reasons.
 */
export const apiKeyReactivityKeys = (organizationId: string) => ({
  apiKeys: [organizationId],
});

/** The key list of one organization, cached per organization id. */
export const apiKeysAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "ApiKeyList",
    { organizationId },
    { reactivityKeys: apiKeyReactivityKeys(organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type ApiKey = Atom.Success<ReturnType<typeof apiKeysAtom>>[number];

export const createApiKeyAtom = DashboardClient.mutation("ApiKeyCreate");
export const revokeApiKeyAtom = DashboardClient.mutation("ApiKeyRevoke");
