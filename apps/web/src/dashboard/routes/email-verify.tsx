import {
  AuthForm,
  OtpFormFields,
  OtpResend,
  otpFormOpts,
} from "@feeblo/post-ui/auth-forms";
import { toResendResult } from "@feeblo/post-ui/otp-resend";
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

import { m } from "@/paraglide/messages";

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
      const redirectTo =
        search.redirectTo?.startsWith("/") &&
        search.redirectTo[1] !== "/" &&
        search.redirectTo[1] !== "\\"
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
      return toResendResult(response.error);
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
                <h1 className="text-xl font-bold">{m.ember_spruce_vale()}</h1>
                <FieldDescription>
                  {m.basil_canyon_fern()}
                </FieldDescription>
              </Field>
              <OtpFormFields form={form} submitLabel={m.cedar_gale_grove()}>
                <OtpResend
                  onResend={resend}
                  successMessage={m.comet_dell_yucca()}
                />
              </OtpFormFields>
            </FieldGroup>
          </AuthForm>
          <Field>
            <FieldDescription className="px-6 text-center">
              {m.boulder_field_maple()}{" "}
              <Link to="/sign-up">{m.kite_purple_raven()}</Link>{" "}
              {m.estuary_purple_wetland()}{" "}
              <Link to="/sign-up">{m.knoll_quiet_velvet()}</Link>
              {m.fjord_jasper_plume()}
            </FieldDescription>
          </Field>
        </div>
      </div>
    </div>
  );
}
