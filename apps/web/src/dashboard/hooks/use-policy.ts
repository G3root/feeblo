import { useMemo } from "react";
import { authClient } from "~/lib/auth-client";

type SessionData = NonNullable<
  ReturnType<typeof authClient.useSession>["data"]
>;

export type ClientPolicy = (session: SessionData) => boolean;

export function usePolicy(policy: ClientPolicy): {
  allowed: boolean;
  isPending: boolean;
} {
  const { data: session, isPending } = authClient.useSession();

  const allowed = useMemo(() => {
    if (!session) {
      return false;
    }
    return policy(session);
  }, [session, policy]);

  return { allowed, isPending };
}

/**
 * Creates a client-side policy from a predicate on the session.
 * Frontend mirror of `packages/domain/src/policy.ts#policy`.
 */
export const policy = (
  predicate: (session: SessionData) => boolean
): ClientPolicy => predicate;

export const hasMembership = (organizationId: string): ClientPolicy =>
  policy((session) =>
    session.memberships.some((m) => m.organizationId === organizationId)
  );

export const hasRole = (role: "owner" | "admin" | "member"): ClientPolicy =>
  policy((session) => session.memberships.some((m) => m.role === role));

export const isUser = (userId: string): ClientPolicy =>
  policy((session) => session.user.id === userId);

export const allPolicy = (
  ...policies: [ClientPolicy, ...ClientPolicy[]]
): ClientPolicy => policy((session) => policies.every((p) => p(session)));

export const anyPolicy = (
  ...policies: [ClientPolicy, ...ClientPolicy[]]
): ClientPolicy => policy((session) => policies.some((p) => p(session)));
