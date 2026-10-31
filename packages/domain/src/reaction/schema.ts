import { ReactionEmojiSchema } from "@feeblo/utils/reaction";
import * as S from "effect/Schema";

/**
 * What a reaction list asks for: one post's reactions, in one workspace.
 *
 * Shared because that is the whole payload for both targets — the dashboard and
 * the portal both ask "the reactions on this post", and a comment reaction is
 * still reached through its post's slug, since the client subscribes to one
 * slug-scoped subset per post page. Only the row shape differs.
 */
export const ReactionList = S.Struct({
  organizationId: S.String,
  slug: S.String,
});

export type ReactionList = S.Schema.Type<typeof ReactionList>;

/**
 * What a toggle answers: the emoji now attached to the target, or nothing.
 *
 * `reacted` is the boolean the client switches on; `emoji` is carried so a
 * caller that toggled one emoji of several learns which one moved without
 * re-reading the list.
 */
export const ReactionToggleResult = S.Struct({
  reacted: S.Boolean,
  emoji: S.Union([ReactionEmojiSchema, S.Null]),
});

export type ReactionToggleResult = S.Schema.Type<typeof ReactionToggleResult>;
