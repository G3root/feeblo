import { Schema } from "effect";

export const REACTION_EMOJI_BY_NAME = {
  thumbs_up: "👍️",
  thumbs_down: "👎️",
  grinning_face_with_smiling_eyes: "😄",
  party_popper: "🎉",
  fire: "🔥",
  eyes: "👀",
  red_heart: "❤️",
  rocket: "🚀",
} as const;

export type ReactionEmojiName = keyof typeof REACTION_EMOJI_BY_NAME;
export type ReactionEmoji = (typeof REACTION_EMOJI_BY_NAME)[ReactionEmojiName];

export const REACTION_EMOJIS = Object.values(
  REACTION_EMOJI_BY_NAME
) as readonly ReactionEmoji[];

export type ReactionCounts = Partial<Record<ReactionEmoji, number>>;

export const ReactionEmojiSchema = Schema.Literals(REACTION_EMOJIS);
