/**
 * Redaction helpers for public list endpoints.
 *
 * Public endpoints (e.g. UpvoteListPublic, PostReactionListPublic) return
 * rows that include internal actor identifiers (userId, memberId). Those
 * identifiers are PII that must never be exposed to unauthenticated callers:
 * they are not needed for any public UI and can be used to enumerate or
 * correlate members across organizations.
 *
 * The current session user's own rows keep their real identifiers so the
 * client can compute "did I upvote / react" state; every other row has them
 * nulled. Display fields (user.name, user.image) are intentionally left
 * intact — they are part of the public UI (voter dialogs, comment threads).
 */

export type ActorRow = {
  userId: string | null;
  memberId: string | null;
};

export const redactActorIdentity = <T extends ActorRow>(
  row: T,
  sessionUserId: string | undefined
): T => {
  if (sessionUserId && row.userId === sessionUserId) {
    return row;
  }
  return { ...row, userId: null, memberId: null };
};

export const redactActorIdentities = <T extends ActorRow>(
  rows: readonly T[],
  sessionUserId: string | undefined
): T[] => {
  const redacted: T[] = new Array<T>(rows.length);
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row) {
      redacted[index] = redactActorIdentity(row, sessionUserId);
    }
  }
  return redacted;
};
