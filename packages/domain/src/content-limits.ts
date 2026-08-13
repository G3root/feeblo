/**
 * Shared input-length limits enforced by the domain schemas.
 *
 * This module is intentionally dependency-free (no `effect`, no Node built-ins)
 * so any frontend — including the lightweight embeddable feedback widget —
 * can import it without pulling schema/effect code into the client bundle.
 *
 * The domain schemas reference these constants directly; frontends should too
 * instead of duplicating the magic numbers.
 */

/** Widget (public feedback portal) bounds. */
export const WIDGET_TITLE_MAX_LENGTH = 200;
export const WIDGET_CONTENT_MAX_LENGTH = 20_000;
export const WIDGET_METADATA_KEY_MAX_LENGTH = 64;
export const WIDGET_METADATA_VALUE_MAX_LENGTH = 500;
export const WIDGET_METADATA_MAX_PROPERTIES = 20;
export const WIDGET_TOKEN_MAX_LENGTH = 8192;

/** Post (dashboard + public) bounds. */
export const POST_TITLE_MIN_LENGTH = 1;
export const POST_TITLE_MAX_LENGTH = 200;
export const POST_CONTENT_MAX_LENGTH = 20_000;
export const POST_OFFICIAL_UPDATE_BODY_MAX_LENGTH = 5000;
export const POST_SUGGESTIONS_LIMIT_MIN = 1;
export const POST_SUGGESTIONS_LIMIT_MAX = 20;

/** Comment bound (dashboard + public). */
export const COMMENT_CONTENT_MAX_LENGTH = 10_000;
