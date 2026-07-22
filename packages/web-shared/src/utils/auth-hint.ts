import type { AuthClientSession } from "@feeblo/auth/client";

/**
 * Server-verified, display-only identity serialized into the initial document.
 * It is never persisted in a browser-readable cookie or used for authorization.
 */
export interface AuthHint {
  readonly user: Pick<AuthClientSession["user"], "email" | "name"> & {
    readonly image: string | null;
  };
  readonly v: 1;
}
