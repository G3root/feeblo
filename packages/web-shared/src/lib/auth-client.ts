import { createAuthClient } from "@feeblo/auth/client";
import { z } from "zod";
import { getClientTimeZone } from "./client-hints";
import { getRuntimePublicEnv } from "./runtime-public-env";

const API_URL = getRuntimePublicEnv().apiUrl;
const baseUrl = API_URL?.endsWith("/") ? API_URL : `${API_URL}/`;

export const verificationOtpEndpoint = `${baseUrl}api/auth/verification-otp`;
export const profilePictureUploadEndpoint = `${baseUrl}api/profile/picture`;
export const organizationLogoUploadEndpoint = `${baseUrl}api/organization/logo`;
export const editorMediaUploadEndpoint = `${baseUrl}api/media/upload`;

export const uploadedEditorMediaSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  kind: z.enum(["image", "video"]),
  url: z.url(),
});

export const authClient = createAuthClient(baseUrl, {
  getTimeZone: getClientTimeZone,
});
