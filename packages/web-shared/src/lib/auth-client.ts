import { createAuthClient } from "@feeblo/auth/client";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import * as Schema from "effect/Schema";

import { getClientTimeZone } from "./client-hints";
import { getRuntimePublicEnv } from "./runtime-public-env";

const API_URL = getRuntimePublicEnv().apiUrl;
// In the dev server the injected API_URL is origin-relative ("/api") so auth
// requests stay same-origin through the Vite proxy and cookies remain
// first-party on *.localhost subdomains. Better Auth requires an absolute base
// URL and appends "/api/auth" itself, so a relative value resolves to the bare
// page origin.
const resolvedApiUrl =
  API_URL?.startsWith("/") && hasWindow() ? window.location.origin : API_URL;
const baseUrl = resolvedApiUrl?.endsWith("/")
  ? resolvedApiUrl
  : `${resolvedApiUrl}/`;

export const verificationOtpEndpoint = `${baseUrl}api/auth/verification-otp`;
export const profilePictureUploadEndpoint = `${baseUrl}api/profile/picture`;
export const organizationLogoUploadEndpoint = `${baseUrl}api/organization/logo`;
export const editorMediaUploadEndpoint = `${baseUrl}api/media/upload`;
export const plansEndpoint = `${baseUrl}api/plans`;

export const uploadedEditorMediaSchema = Schema.Struct({
  assetId: Schema.String,
  bucket: Schema.String,
  key: Schema.String,
  kind: Schema.Literal("image"),
  url: Schema.String,
});

export type UploadedEditorMedia = Schema.Schema.Type<
  typeof uploadedEditorMediaSchema
>;

export type EditorMediaUploadOptions = {
  readonly organizationId?: string;
  readonly timeoutMs?: number;
};

export const authClient = createAuthClient(baseUrl, {
  getTimeZone: getClientTimeZone,
});
