import { toastManager } from "@feeblo/ui/toast";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useCallback } from "react";

import { initializeEmailVerification } from "./auth-flows";
import { clearVerificationOtp } from "./otp-resend";

export type AuthErrorLike = {
  code?: string;
  message?: string | null;
};

type SignInEmailInput = {
  email: string;
  password: string;
};

export type SignInEmailResult =
  | { readonly type: "success" }
  | { readonly type: "email-not-verified"; readonly ready: boolean }
  | { readonly type: "error"; readonly error: AuthErrorLike };

export function useSignInEmail({
  getCallbackURL,
  onEmailNotVerified,
  onSuccess,
}: {
  getCallbackURL: () => string;
  onEmailNotVerified?: (email: string) => void | Promise<void>;
  onSuccess?: () => void | Promise<void>;
}) {
  return useCallback(
    async ({
      email,
      password,
    }: SignInEmailInput): Promise<SignInEmailResult> => {
      try {
        const response = await authClient.signIn.email({
          email,
          password,
          callbackURL: getCallbackURL(),
        });

        if (!response.error) {
          await onSuccess?.();
          return { type: "success" };
        }

        if (response.error.code === "EMAIL_NOT_VERIFIED") {
          const ready = await initializeEmailVerification(email);
          if (ready) {
            await onEmailNotVerified?.(email);
          }
          return { type: "email-not-verified", ready };
        }

        return { type: "error", error: response.error };
      } catch (error) {
        return {
          type: "error",
          error: {
            message:
              error instanceof Error ? error.message : "Something went wrong",
          },
        };
      }
    },
    [getCallbackURL, onEmailNotVerified, onSuccess]
  );
}

type SignUpEmailInput = {
  email: string;
  name: string;
  password: string;
};

export type SignUpEmailResult =
  | { readonly type: "success" }
  | {
      readonly type: "verify-email";
      readonly email: string;
      readonly ready: boolean;
    }
  | { readonly type: "error"; readonly error: AuthErrorLike };

export function useSignUpEmail({
  getCallbackURL,
  getCaptchaToken,
  onSuccess,
  onVerifyEmail,
}: {
  getCallbackURL: () => string;
  getCaptchaToken?: () => string | null;
  onSuccess?: () => void | Promise<void>;
  onVerifyEmail?: (email: string) => void | Promise<void>;
}) {
  return useCallback(
    async ({
      email,
      name,
      password,
    }: SignUpEmailInput): Promise<SignUpEmailResult> => {
      try {
        const captchaToken = getCaptchaToken?.();
        const response = await authClient.signUp.email({
          email,
          name,
          password,
          callbackURL: getCallbackURL(),
          fetchOptions: captchaToken
            ? { headers: { "x-captcha-response": captchaToken } }
            : undefined,
        });

        if (response.error) {
          return { type: "error", error: response.error };
        }

        const verificationEmail = response.data?.user?.email ?? email;
        if (!response.data?.user.emailVerified) {
          const ready = await initializeEmailVerification(verificationEmail);
          if (ready) {
            await onVerifyEmail?.(verificationEmail);
          }
          return { type: "verify-email", email: verificationEmail, ready };
        }

        await onSuccess?.();
        return { type: "success" };
      } catch (error) {
        return {
          type: "error",
          error: {
            message:
              error instanceof Error ? error.message : "Something went wrong",
          },
        };
      }
    },
    [getCallbackURL, getCaptchaToken, onSuccess, onVerifyEmail]
  );
}

export function useVerifyEmailOtp({
  email,
  onSuccess,
}: {
  email: string;
  onSuccess?: () => void | Promise<void>;
}) {
  return useCallback(
    async (otp: string): Promise<boolean> => {
      try {
        const response = await authClient.emailOtp.verifyEmail({ email, otp });

        if (response.error) {
          toastManager.add({
            title:
              response.error.code === "INVALID_OTP"
                ? "Invalid verification code"
                : response.error.message,
            type: "error",
          });
          return false;
        }

        toastManager.add({
          title: "Email verified",
          type: "success",
        });

        await clearVerificationOtp(email, "email-verification");
        await onSuccess?.();
        return true;
      } catch (error) {
        toastManager.add({
          title:
            error instanceof Error ? error.message : "Something went wrong",
          type: "error",
        });
        return false;
      }
    },
    [email, onSuccess]
  );
}

export function useCheckResetPasswordOtp({
  email,
  onUserNotFound,
  onVerified,
}: {
  email: string;
  onUserNotFound?: () => void | Promise<void>;
  onVerified: (otp: string) => void | Promise<void>;
}) {
  return useCallback(
    async (otp: string): Promise<boolean> => {
      try {
        const response = await authClient.emailOtp.checkVerificationOtp({
          email,
          otp,
          type: "forget-password",
        });

        if (response.error) {
          switch (response.error.code) {
            case "INVALID_OTP":
              toastManager.add({
                title: "Invalid verification code",
                type: "error",
              });
              return false;
            case "OTP_EXPIRED":
              toastManager.add({
                title: "This code has expired. Request a new one.",
                type: "error",
              });
              return false;
            case "TOO_MANY_ATTEMPTS":
              toastManager.add({
                title: "Too many attempts. Request a new code.",
                type: "error",
              });
              return false;
            case "USER_NOT_FOUND":
              toastManager.add({
                title: "This account is no longer available. Please try again.",
                type: "error",
              });
              await onUserNotFound?.();
              return false;
            default:
              toastManager.add({
                title: response.error.message,
                type: "error",
              });
              return false;
          }
        }

        await onVerified(otp);
        return true;
      } catch (error) {
        toastManager.add({
          title:
            error instanceof Error ? error.message : "Something went wrong",
          type: "error",
        });
        return false;
      }
    },
    [email, onUserNotFound, onVerified]
  );
}

export type SignInErrorField = {
  field: "email" | "password";
  message: string;
};

export function getSignInErrorField(error: AuthErrorLike): SignInErrorField {
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return { field: "password", message: "Invalid email or password" };
    case "EMAIL_BLOCKED":
      return { field: "email", message: "Email is blocked." };
    default:
      return {
        field: "email",
        message: error.message ?? "Something went wrong",
      };
  }
}

export type SignUpErrorField = {
  field: "email";
  message: string;
};

export function getSignUpErrorField(error: AuthErrorLike): SignUpErrorField {
  switch (error.code) {
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return {
        field: "email",
        message: "A user with that email already exists",
      };
    case "EMAIL_BLOCKED":
      return { field: "email", message: "Email is blocked." };
    case "TEMPORARY_EMAIL_NOT_ALLOWED":
      return {
        field: "email",
        message: "Temporary email addresses are not allowed.",
      };
    default:
      return {
        field: "email",
        message: error.message ?? "Something went wrong",
      };
  }
}
