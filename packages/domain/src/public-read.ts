import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as Policy from "./policy";
import { OptionalCurrentSession, type Session } from "./session-middleware";

/**
 * The viewer a public read runs as: the optional session reduced to the two
 * facts a projection may use — the session user's id, and whether that user
 * is a member of the organization being read.
 */
export type PublicViewer = {
  readonly userId: string | undefined;
  readonly isMember: (organizationId: string) => boolean;
};

const viewerFrom = (session: Option.Option<Session>): PublicViewer => ({
  isMember: (organizationId) =>
    Option.match(session, {
      onNone: () => false,
      onSome: (value) => Policy.isMember(value, organizationId),
    }),
  userId: Option.match(session, {
    onNone: () => undefined,
    onSome: (value) => value.session.userId,
  }),
});

/**
 * The viewer the current optional session resolves to. A read that varies its
 * projection by membership (e.g. internal comments) reads this directly; a
 * read that carries actor identifiers uses `withPublicViewer`.
 */
export const currentPublicViewer: Effect.Effect<
  PublicViewer,
  never,
  OptionalCurrentSession
> = Effect.map(OptionalCurrentSession, viewerFrom);

/**
 * Runs a public read as the current viewer, then applies the surface's
 * redaction. The rule — an actor identifier reaches a public caller only on
 * the viewer's own rows — is applied here rather than at each call site, so a
 * public read cannot return rows before the redaction ran.
 */
export const withPublicViewer = <A, E, R, B>(options: {
  readonly read: (viewer: PublicViewer) => Effect.Effect<A, E, R>;
  readonly redact: (result: A, viewerUserId: string | undefined) => B;
}): Effect.Effect<B, E, R | OptionalCurrentSession> =>
  Effect.flatMap(currentPublicViewer, (viewer) =>
    Effect.map(options.read(viewer), (result) =>
      options.redact(result, viewer.userId)
    )
  );
