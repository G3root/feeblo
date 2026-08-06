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
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

const RESEND_COOLDOWN_SECONDS = 60;

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

const FormSchema = z.object({
  otp: z.string().length(6, { message: "Verification code must be 6 digits" }),
});

const RateLimitErrorSchema = z.object({
  code: z.literal("VERIFICATION_OTP_RATE_LIMITED"),
  retryAfterSeconds: z.number().int().positive(),
});

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function getResendLabel({
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

export const Route = createFileRoute("/email-verify")({
  validateSearch: (search) => SearchSchema.parse(search),
  loader: async () => {
    const response = await fetch(verificationOtpEndpoint, {
      credentials: "include",
    });

    if (!response.ok) {
      throw redirect({ to: "/sign-up" });
    }

    const parsed = z
      .object({
        email: z.email(),
        type: z.enum(["email-verification", "reset-password"]),
      })
      .safeParse(await response.json());

    if (!parsed.success) {
      throw redirect({ to: "/sign-up" });
    }

    if (parsed.data.type === "reset-password") {
      throw redirect({ to: "/reset-password" });
    }

    return parsed.data;
  },
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const verificationState = Route.useLoaderData();
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

  const form = useAppForm({
    defaultValues: {
      otp: "",
    },
    validators: {
      onChange: FormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.emailOtp.verifyEmail({
        email: verificationState.email,
        otp: value.otp,
      });

      if (response.error) {
        toastManager.add({
          title:
            response.error.code === "INVALID_OTP"
              ? "Invalid verification code"
              : response.error.message,
          type: "error",
        });
        return;
      }

      toastManager.add({
        title: "Email verified",
        type: "success",
      });

      await fetch(verificationOtpEndpoint, {
        method: "DELETE",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: verificationState.email,
          type: "email-verification",
        }),
      });

      const redirectTo = search.redirectTo?.startsWith("/")
        ? search.redirectTo
        : "/";

      window.location.href = redirectTo;
    },
  });

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <FieldGroup>
              <Field className="items-center text-center">
                <Link
                  className="flex flex-col items-center gap-2 font-medium"
                  to="/sign-up"
                >
                  <span className="flex size-8 items-center justify-center rounded-md">
                    {/* <IconKeyframes aria-hidden="true" className="size-6" /> */}
                  </span>
                  <span className="sr-only">Acme Inc.</span>
                </Link>
                <h1 className="font-bold text-xl">Enter verification code</h1>
                <FieldDescription>
                  We sent a 6-digit code to your email address
                </FieldDescription>
              </Field>
              <form.Field
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
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                      <FieldDescription className="text-center">
                        Didn&apos;t receive the code?
                        <Button
                          disabled={resendCooldown > 0 || isResending}
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsResending(true);
                            const response = await authClient.emailOtp
                              .sendVerificationOtp({
                                email: verificationState.email,
                                type: "email-verification",
                              })
                              .finally(() => setIsResending(false));

                            if (!response.error) {
                              setResendCooldown(RESEND_COOLDOWN_SECONDS);
                              toastManager.add({
                                title: "Verification code sent",
                                type: "success",
                              });
                              return;
                            }

                            const rateLimitError =
                              RateLimitErrorSchema.safeParse(response.error);
                            if (rateLimitError.success) {
                              setResendCooldown(
                                rateLimitError.data.retryAfterSeconds
                              );
                            }

                            toastManager.add({
                              title: response.error.message,
                              type: "error",
                            });
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
                            : "You can request another verification code now"}
                        </span>
                      </FieldDescription>
                    </Field>
                  );
                }}
                name="otp"
              />

              <Field>
                <Button type="submit">Verify</Button>
              </Field>
            </FieldGroup>
          </form>
          <Field>
            <FieldDescription className="px-6 text-center">
              By clicking continue, you agree to our{" "}
              <Link to="/sign-up">Terms of Service</Link> and{" "}
              <Link to="/sign-up">Privacy Policy</Link>.
            </FieldDescription>
          </Field>
        </div>
      </div>
    </div>
  );
}
