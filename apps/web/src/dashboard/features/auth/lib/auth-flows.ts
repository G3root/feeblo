import { toastManager } from "~/components/ui/toast";
import { authClient, verificationOtpEndpoint } from "~/lib/auth-client";

export type SocialProvider = "github" | "google";

export const getSafeCallbackURL = (redirectTo?: string) =>
  redirectTo?.startsWith("/") ? redirectTo : "/";

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
