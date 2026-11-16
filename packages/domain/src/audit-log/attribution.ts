import * as Policy from "../policy";
import type { Session } from "../session-middleware";
import type { TAuditActorRef } from "./recorder";

/**
 * Who is behind an audited action, as known at the call site.
 *
 * One function per surface, so no handler invents attribution: a dashboard
 * write is always the session's user, and the role that admitted the write is
 * frozen onto the entry. A later demotion must not rewrite what the entry says
 * about the authority it was taken under.
 */
export const actorFromSession = (
  session: Session,
  organizationId: string
): TAuditActorRef => {
  const membership = Policy.getMembership(session, organizationId);

  return {
    type: "user",
    userId: session.session.userId,
    ...(membership === undefined ? undefined : { role: membership.role }),
  };
};

/**
 * The product acting on its own: a sweep, a delivery retry, a fan-out.
 *
 * There is no caller to name, and claiming one would put a member's name on
 * something no member did.
 */
export const actorFromSystem = (): TAuditActorRef => ({ type: "system" });
