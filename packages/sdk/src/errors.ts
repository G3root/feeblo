export interface EmbedErrorDetails {
  code: string;
  message: string;
}

/**
 * Error thrown or reported by the Feeblo SDK. Every error carries a stable
 * `code` so integrators can branch on known failure modes.
 */
export class EmbedError extends Error {
  code: string;

  constructor({ code, message }: EmbedErrorDetails) {
    super(message);
    this.code = code;
    this.name = "EmbedError";
  }
}
