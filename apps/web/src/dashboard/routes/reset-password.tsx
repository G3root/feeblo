import {
  AuthForm,
  OtpFormFields,
  OtpResend,
  otpFormOpts,
} from "@feeblo/post-ui/auth-forms";
import {
  clearVerificationOtp,
  toResendResult,
} from "@feeblo/post-ui/otp-resend";
import { useCheckResetPasswordOtp } from "@feeblo/post-ui/use-auth-submission";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import {
  authClient,
  verificationOtpEndpoint,
} from "@feeblo/web-shared/auth-client";
import { PasswordAndConfirmPasswordSchema } from "@feeblo/web-shared/user-validation";
import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { AuthShell } from "~/features/auth/components/auth-shell";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

const PasswordFormSchema = PasswordAndConfirmPasswordSchema;

export const Route = createFileRoute("/reset-password")({
  validateSearch: (search) => SearchSchema.parse(search),
  loader: async () => {
    const response = await fetch(verificationOtpEndpoint, {
      credentials: "include",
    });

    if (!response.ok) {
      throw redirect({ to: "/forgot-password" });
    }

    const parsed = z
      .object({
        email: z.email(),
        type: z.enum(["email-verification", "reset-password"]),
      })
      .safeParse(await response.json());

    if (!parsed.success || parsed.data.type !== "reset-password") {
      throw redirect({ to: "/forgot-password" });
    }

    return parsed.data;
  },
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate({ from: "/reset-password" });
  const search = Route.useSearch();
  const { email } = Route.useLoaderData();
  const [step, setStep] = useState<"otp" | "password">("otp");
  const [otp, setOtp] = useState("");
  const passwordHeadingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step === "password") {
      passwordHeadingRef.current?.focus();
    }
  }, [step]);

  const resendResetCode = useCallback(async () => {
    const response = await authClient.emailOtp.requestPasswordReset({
      email,
    });

    if (response.error) {
      return toResendResult(response.error);
    }

    return { success: true as const };
  }, [email]);

  const checkResetOtp = useCheckResetPasswordOtp({
    email,
    onUserNotFound: () => navigate({ to: "/forgot-password" }),
    onVerified: (nextOtp) => {
      setOtp(nextOtp);
      setStep("password");
    },
  });

  const otpForm = useAppForm({
    ...otpFormOpts,
    onSubmit: async ({ value }) => {
      await checkResetOtp(value.otp);
    },
  });

  const passwordForm = useAppForm({
    defaultValues: {
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: PasswordFormSchema,
    },
    onSubmit: async ({ value }) => {
      passwordForm.setErrorMap({
        onSubmit: undefined,
      });

      let response: Awaited<
        ReturnType<typeof authClient.emailOtp.resetPassword>
      >;
      try {
        response = await authClient.emailOtp.resetPassword({
          email,
          otp,
          password: value.password,
        });
      } catch (error) {
        passwordForm.setErrorMap({
          onSubmit: {
            fields: {
              password: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Something went wrong",
              },
            },
          },
        });
        return;
      }

      if (response.error) {
        if (
          response.error.code === "INVALID_OTP" ||
          response.error.code === "OTP_EXPIRED" ||
          response.error.code === "TOO_MANY_ATTEMPTS"
        ) {
          toastManager.add({
            title: "This reset code is no longer valid. Request a new one.",
            type: "error",
          });
          setStep("otp");
          return;
        }

        passwordForm.setErrorMap({
          onSubmit: {
            fields: {
              password: {
                message: response.error.message,
              },
            },
          },
        });
        return;
      }

      await clearVerificationOtp(email, "reset-password");

      toastManager.add({
        title: "Password reset. Please sign in with your new password.",
        type: "success",
      });

      // Password resets don't revoke existing sessions server-side, so sign
      // out to clear the stale session cookie; otherwise the authenticated
      // middleware redirect would bounce the user away from /sign-in.
      try {
        await authClient.signOut();
      } catch {
        // Best-effort: proceed to /sign-in even if revocation fails.
      }

      await navigate({
        to: "/sign-in",
        search: { redirectTo: search.redirectTo },
      });
    },
  });

  if (step === "password") {
    return (
      <AuthShell
        description={`Choose a new password for ${email}.`}
        footer={
          <div className="text-center text-sm">
            Remembered your password?{" "}
            <Link className="underline underline-offset-4" to="/sign-in">
              Sign in
            </Link>
          </div>
        }
        title="Reset your password"
        titleRef={passwordHeadingRef}
      >
        <AuthForm form={passwordForm}>
          <passwordForm.AppField name="password">
            {(field) => <field.PasswordField label="New Password" />}
          </passwordForm.AppField>

          <passwordForm.AppField name="confirmPassword">
            {(field) => <field.PasswordField label="Confirm Password" />}
          </passwordForm.AppField>

          <passwordForm.AppForm>
            <passwordForm.SubscribeButton
              className="w-full"
              label="Update password"
              type="submit"
            />
          </passwordForm.AppForm>
        </AuthForm>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description={`We sent a 6-digit code to ${email}.`}
      footer={
        <div className="text-center text-sm">
          Remembered your password?{" "}
          <Link className="underline underline-offset-4" to="/sign-in">
            Sign in
          </Link>
        </div>
      }
      title="Enter verification code"
    >
      <AuthForm form={otpForm}>
        <OtpFormFields form={otpForm} submitLabel="Continue">
          <OtpResend
            onResend={resendResetCode}
            successMessage="Reset code sent"
          />
        </OtpFormFields>
      </AuthForm>
    </AuthShell>
  );
}
