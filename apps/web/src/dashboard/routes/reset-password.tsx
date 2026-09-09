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

import { m } from "@/paraglide/messages";
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
                    : m.fjord_grove_kindle(),
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
            title: m.kite_umbra_zephyr(),
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
        title: m.nectar_pine_wander(),
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
        description={m.amber_flint_heath({ email })}
        footer={
          <div className="text-center text-sm">
            {m.glacier_mellow_prairie()}{" "}
            <Link className="underline underline-offset-4" to="/sign-in">
              {m.glade_marsh_moss()}
            </Link>
          </div>
        }
        title={m.amber_juniper_quiet()}
        titleRef={passwordHeadingRef}
      >
        <AuthForm form={passwordForm}>
          <passwordForm.AppField name="password">
            {(field) => <field.PasswordField label={m.coast_field_tulip()} />}
          </passwordForm.AppField>

          <passwordForm.AppField name="confirmPassword">
            {(field) => <field.PasswordField label={m.cinder_dune_north()} />}
          </passwordForm.AppField>

          <passwordForm.AppForm>
            <passwordForm.SubscribeButton
              className="w-full"
              label={m.nimbus_orchard_vine()}
              type="submit"
            />
          </passwordForm.AppForm>
        </AuthForm>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      description={m.gale_jolly_tulip({ email })}
      footer={
        <div className="text-center text-sm">
          {m.glacier_mellow_prairie()}{" "}
          <Link className="underline underline-offset-4" to="/sign-in">
            {m.glade_marsh_moss()}
          </Link>
        </div>
      }
      title={m.delta_inlet_nimbus()}
    >
      <AuthForm form={otpForm}>
        <OtpFormFields form={otpForm} submitLabel={m.comet_drift_eager()}>
          <OtpResend
            onResend={resendResetCode}
            successMessage={m.gulf_oasis_vale()}
          />
        </OtpFormFields>
      </AuthForm>
    </AuthShell>
  );
}
