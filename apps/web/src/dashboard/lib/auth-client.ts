import {
  type AuthClientSession,
  authStateSchema,
  createAuthClient,
} from "@feeblo/auth/client";
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

export type AuthState = z.infer<typeof authStateSchema>;

export type ValidAuthState = AuthState & {
  session: NonNullable<AuthState["session"]>;
  user: NonNullable<AuthState["user"]>;
};

export const AUTH_STATE_KEY = "auth";

export const isAuthStateValid = (
  state: AuthState | undefined | null
): state is ValidAuthState => {
  return (
    !!state &&
    !!state.session &&
    !!state.user &&
    state.session.expiresAt > new Date()
  );
};

export const getAuthState = (): ValidAuthState | undefined => {
  const state = authStateCollection.get(AUTH_STATE_KEY) as
    | AuthState
    | undefined;
  return isAuthStateValid(state) ? state : undefined;
};

export const updateAuthState = (data: AuthClientSession): AuthState => {
  const state: AuthState = {
    id: AUTH_STATE_KEY,
    session: data.session,
    user: data.user,
    memberships: data.memberships,
    organizations: data.organizations,
  };

  if (authStateCollection.has(AUTH_STATE_KEY)) {
    authStateCollection.update(AUTH_STATE_KEY, (draft) => {
      draft.session = state.session;
      draft.user = state.user;
      draft.memberships = state.memberships;
      draft.organizations = state.organizations;
    });
  } else {
    authStateCollection.insert(state);
  }

  return state;
};
