import { toastManager } from "@feeblo/ui/toast";
import { hasWindow, isObject } from "@feeblo/utils/runtime-kind";
import {
  authClient,
  verificationOtpEndpoint,
} from "@feeblo/web-shared/auth-client";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";

export type SocialProvider = "github" | "google";

export const getSafeCallbackURL = (redirectTo?: string) => {
  const safePath =
    redirectTo?.startsWith("/") &&
    redirectTo[1] !== "/" &&
    redirectTo[1] !== "\\"
      ? redirectTo
      : "/";
  const currentOrigin = hasWindow() ? window.location.origin : undefined;
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

export async function initializePasswordReset(email: string) {
  const response = await fetch(verificationOtpEndpoint, {
    method: "POST",
    credentials: "include",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      email,
      type: "reset-password",
    }),
  });

  if (!response.ok) {
    const serverMessage = await response
      .json()
      .then((body) => {
        if (isObject(body)) {
          // SAFETY: isObject establishes that the response body is a
          // non-null object; the optional-field view only exposes the
          // error-message claim the UI renders.
          const record = body as { error?: { message?: string } };
          return record.error?.message;
        }
        return undefined;
      })
      .catch(() => undefined);

    toastManager.add({
      title: serverMessage ?? "Failed to initialize password reset",
      type: "error",
    });
    return false;
  }

  return true;
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
    ...(requestSignUp && { requestSignUp: true }),
  });

  if (!response.error) {
    return;
  }

  toastManager.add({
    title: response.error.message,
    type: "error",
  });
}
