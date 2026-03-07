import { VITE_API_URL } from "astro:env/client";
import { createAuthClient } from "@feeblo/auth/client";
import { z } from "zod";

const baseUrl = VITE_API_URL?.endsWith("/") ? VITE_API_URL : `${VITE_API_URL}/`;

export const verificationOtpEndpoint = `${baseUrl}api/auth/verification-otp`;
export const profilePictureUploadEndpoint = `${baseUrl}api/profile/picture`;
export const editorMediaUploadEndpoint = `${baseUrl}api/media/upload`;

export const uploadedEditorMediaSchema = z.object({
  bucket: z.string(),
  key: z.string(),
  kind: z.enum(["image", "video"]),
  url: z.url(),
});

export const authClient = createAuthClient(baseUrl);
