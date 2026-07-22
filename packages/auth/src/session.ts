import * as Duration from "effect/Duration";

/** Shared lifetime for Better Auth sessions and display-only auth hints. */
export const AUTH_SESSION_DURATION = Duration.days(7);

export const AUTH_SESSION_DURATION_SECONDS = Duration.toSeconds(
  AUTH_SESSION_DURATION
);
