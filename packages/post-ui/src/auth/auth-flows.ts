import { toastManager } from "@feeblo/ui/toast";
import {
  authClient,
  verificationOtpEndpoint,
} from "@feeblo/web-shared/auth-client";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";

export type SocialProvider = "github" | "google";

export const getSafeCallbackURL = (redirectTo?: string) => {
  const safePath = redirectTo?.startsWith("/") ? redirectTo : "/";
  const currentOrigin =
    typeof window !== "undefined" ? window.location.origin : undefined;
  const appUrl = getRuntimePublicEnv().appUrl;
  const callbackBase = currentOrigin ?? appUrl;

  if (!callbackBase) {
    return safePath;
  }

  return new URL(safePath, callbackBase).toString();
};

export async function initializeEmailVerification(email: string) {
  const response = await fetch(verificationOtpEndpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      type: "email-verification",
    }),
  });

  if (response.ok) {
    return true;
  }

  toastManager.add({
    title: "Failed to initialize verification",
    type: "error",
  });
  return false;
}

export async function signInWithSocialProvider({
  provider,
  redirectTo,
  requestSignUp = false,
}: {
  provider: SocialProvider;
  redirectTo?: string;
  requestSignUp?: boolean;
}) {
  const response = await authClient.signIn.social({
    provider,
    callbackURL: getSafeCallbackURL(redirectTo),
    ...(requestSignUp ? { requestSignUp: true } : {}),
  });

  if (!response.error) {
    return;
  }

  toastManager.add({
    title: response.error.message,
    type: "error",
  });
}
