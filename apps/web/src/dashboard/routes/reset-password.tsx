import { Button } from "@feeblo/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from "@feeblo/ui/otp-field";
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
import { useEffect, useState } from "react";
import { z } from "zod";
import { AuthShell } from "~/features/auth/components/auth-shell";
import {
  getResendLabel,
  RESEND_COOLDOWN_SECONDS,
} from "~/features/auth/lib/resend-countdown";

const OtpFormSchema = z.object({
  otp: z.string().length(6, { message: "Verification code must be 6 digits" }),
});

const PasswordFormSchema = PasswordAndConfirmPasswordSchema;

const RateLimitErrorSchema = z.object({
  code: z.literal("VERIFICATION_OTP_RATE_LIMITED"),
  retryAfterSeconds: z.number().int().positive(),
});

export const Route = createFileRoute("/reset-password")({
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
  const { email } = Route.useLoaderData();
  const [step, setStep] = useState<"otp" | "password">("otp");
  const [otp, setOtp] = useState("");
  const [resendCooldown, setResendCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [isResending, setIsResending] = useState(false);

  useEffect(() => {
    if (resendCooldown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => window.clearTimeout(timer);
  }, [resendCooldown]);

  const resendResetCode = async () => {
    setIsResending(true);
    const response = await authClient.emailOtp
      .requestPasswordReset({ email })
      .finally(() => setIsResending(false));

    if (!response.error) {
      setResendCooldown(RESEND_COOLDOWN_SECONDS);
      toastManager.add({
        title: "Reset code sent",
        type: "success",
      });
      return;
    }

    const rateLimitError = RateLimitErrorSchema.safeParse(response.error);
    if (rateLimitError.success) {
      setResendCooldown(rateLimitError.data.retryAfterSeconds);
    }

    toastManager.add({
      title: response.error.message,
      type: "error",
    });
  };

  const otpForm = useAppForm({
    defaultValues: {
      otp: "",
    },
    validators: {
      onChange: OtpFormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.emailOtp.checkVerificationOtp({
        email,
        otp: value.otp,
        type: "forget-password",
      });

      if (response.error) {
        switch (response.error.code) {
          case "INVALID_OTP": {
            toastManager.add({
              title: "Invalid verification code",
              type: "error",
            });
            return;
          }
          case "OTP_EXPIRED": {
            toastManager.add({
              title: "This code has expired. Request a new one.",
              type: "error",
            });
            return;
          }
          case "TOO_MANY_ATTEMPTS": {
            toastManager.add({
              title: "Too many attempts. Request a new code.",
              type: "error",
            });
            return;
          }
          case "USER_NOT_FOUND": {
            toastManager.add({
              title: "No reset request found for this account.",
              type: "error",
            });
            await navigate({ to: "/forgot-password" });
            return;
          }
          default: {
            toastManager.add({
              title: response.error.message,
              type: "error",
            });
            return;
          }
        }
      }

      setOtp(value.otp);
      setStep("password");
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

      const response = await authClient.emailOtp.resetPassword({
        email,
        otp,
        password: value.password,
      });

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

      await fetch(verificationOtpEndpoint, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          type: "reset-password",
        }),
      });

      toastManager.add({
        title: "Password reset. Please sign in with your new password.",
        type: "success",
      });
      await navigate({ to: "/sign-in" });
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
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            passwordForm.handleSubmit();
          }}
        >
          <div className="flex flex-col gap-4">
            <passwordForm.AppField
              children={(field) => (
                <field.TextField label="New Password" type="password" />
              )}
              name="password"
            />

            <passwordForm.AppField
              children={(field) => (
                <field.TextField label="Confirm Password" type="password" />
              )}
              name="confirmPassword"
            />

            <passwordForm.AppForm>
              <passwordForm.SubscribeButton
                className="w-full"
                label="Update password"
                type="submit"
              />
            </passwordForm.AppForm>
          </div>
        </form>
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
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          otpForm.handleSubmit();
        }}
      >
        <FieldGroup>
          <otpForm.Field
            children={(field) => {
              const isInvalid =
                field.state.meta.isTouched && !field.state.meta.isValid;
              return (
                <Field data-invalid={isInvalid}>
                  <FieldLabel className="sr-only" htmlFor={field.name}>
                    Verification code
                  </FieldLabel>
                  <OTPField
                    aria-label="Verification code"
                    className="justify-center gap-4"
                    id={field.name}
                    length={6}
                    name={field.name}
                    onBlur={field.handleBlur}
                    onValueChange={(value) => field.handleChange(value)}
                    size="lg"
                    value={field.state.value}
                  >
                    <OTPFieldInput />
                    <OTPFieldInput aria-label="Character 2 of 6" />
                    <OTPFieldInput aria-label="Character 3 of 6" />
                    <OTPFieldSeparator />
                    <OTPFieldInput aria-label="Character 4 of 6" />
                    <OTPFieldInput aria-label="Character 5 of 6" />
                    <OTPFieldInput aria-label="Character 6 of 6" />
                  </OTPField>
                  {isInvalid && <FieldError errors={field.state.meta.errors} />}
                  <FieldDescription className="text-center">
                    Didn&apos;t receive the code?
                    <Button
                      disabled={resendCooldown > 0 || isResending}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        resendResetCode();
                      }}
                      type="button"
                      variant="link"
                    >
                      {getResendLabel({
                        cooldown: resendCooldown,
                        isResending,
                      })}
                    </Button>
                    <span className="sr-only" role="timer">
                      {resendCooldown > 0
                        ? `You can request another code in ${resendCooldown} seconds`
                        : "You can request another reset code now"}
                    </span>
                  </FieldDescription>
                </Field>
              );
            }}
            name="otp"
          />

          <Field>
            <Button type="submit">Continue</Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
