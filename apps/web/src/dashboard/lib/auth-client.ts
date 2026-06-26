import { authStateSchema, createAuthClient } from "@feeblo/auth/client";
import {
  createCollection,
  localOnlyCollectionOptions,
} from "@tanstack/react-db";
import { z } from "zod";
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

export const authClient = createAuthClient(baseUrl);

export const authStateCollection = createCollection(
  localOnlyCollectionOptions({
    id: "auth-state",
    getKey: (item) => item.id,
    schema: authStateSchema,
  })
);
