import {
  AuthForm,
  OtpFormFields,
  OtpResend,
  otpFormOpts,
} from "@feeblo/post-ui/auth-forms";
import { RateLimitErrorSchema } from "@feeblo/post-ui/otp-resend";
import { useVerifyEmailOtp } from "@feeblo/post-ui/use-auth-submission";
import { Field, FieldDescription, FieldGroup } from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  authClient,
  verificationOtpEndpoint,
} from "@feeblo/web-shared/auth-client";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

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

  const verifyOtp = useVerifyEmailOtp({
    email: verificationState.email,
    onSuccess: () => {
      const redirectTo = search.redirectTo?.startsWith("/")
        ? search.redirectTo
        : "/";

      window.location.href = redirectTo;
    },
  });

  const resend = useCallback(async () => {
    const response = await authClient.emailOtp.sendVerificationOtp({
      email: verificationState.email,
      type: "email-verification",
    });

    if (response.error) {
      const rateLimitError = RateLimitErrorSchema.safeParse(response.error);
      return {
        success: false as const,
        retryAfterSeconds: rateLimitError.success
          ? rateLimitError.data.retryAfterSeconds
          : undefined,
        message: response.error.message,
      };
    }

    return { success: true as const };
  }, [verificationState.email]);

  const form = useAppForm({
    ...otpFormOpts,
    onSubmit: async ({ value }) => {
      await verifyOtp(value.otp);
    },
  });

  return (
    <div className="bg-background flex min-h-svh flex-col items-center justify-center gap-6 p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <AuthForm form={form}>
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
                <h1 className="text-xl font-bold">Enter verification code</h1>
                <FieldDescription>
                  We sent a 6-digit code to your email address
                </FieldDescription>
              </Field>
              <OtpFormFields form={form} submitLabel="Verify">
                <OtpResend
                  onResend={resend}
                  successMessage="Verification code sent"
                />
              </OtpFormFields>
            </FieldGroup>
          </AuthForm>
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
