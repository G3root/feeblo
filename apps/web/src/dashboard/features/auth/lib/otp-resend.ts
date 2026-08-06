import { toastManager } from "@feeblo/ui/toast";
import { verificationOtpEndpoint } from "@feeblo/web-shared/auth-client";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

export const RESEND_COOLDOWN_SECONDS = 60;

export const RateLimitErrorSchema = z.object({
  code: z.literal("VERIFICATION_OTP_RATE_LIMITED"),
  retryAfterSeconds: z.number().int().positive(),
});

export function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getResendLabel({
  cooldown,
  isResending,
}: {
  cooldown: number;
  isResending: boolean;
}) {
  if (isResending) {
    return "Sending…";
  }
  if (cooldown > 0) {
    return `Resend in ${formatCountdown(cooldown)}`;
  }
  return "Resend code";
}

export async function clearVerificationOtp(
  email: string,
  type: "email-verification" | "reset-password"
) {
  await fetch(verificationOtpEndpoint, {
    method: "DELETE",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      type,
    }),
  });
}

export type ResendResult =
  | { readonly success: true }
  | {
      readonly success: false;
      readonly retryAfterSeconds?: number;
      readonly message?: string;
    };

/**
 * Encapsulates the shared OTP resend UX: a countdown cooldown, an in-flight
 * flag, rate-limit-aware error handling, and success/error toasts. The caller
 * provides the actual send call (`onResend`), which should map any
 * VERIFICATION_OTP_RATE_LIMITED error to `retryAfterSeconds`.
 */
export function useOtpResend({
  onResend,
  successMessage,
}: {
  onResend: () => Promise<ResendResult>;
  successMessage: string;
}) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const resend = useCallback(async () => {
    setIsResending(true);
    const result = await onResend().finally(() => setIsResending(false));

    if (result.success) {
      setCooldown(RESEND_COOLDOWN_SECONDS);
      toastManager.add({
        title: successMessage,
        type: "success",
      });
      return;
    }

    if (result.retryAfterSeconds !== undefined) {
      setCooldown(result.retryAfterSeconds);
    }
    toastManager.add({
      title: result.message ?? "Failed to send verification code",
      type: "error",
    });
  }, [onResend, successMessage]);

  return { cooldown, isResending, resend };
}
