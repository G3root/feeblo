import { getSafeCallbackURL } from "@feeblo/post-ui/auth-flows";
import {
  AuthForm,
  SignUpFields,
  signUpFormOpts,
} from "@feeblo/post-ui/auth-forms";
import { SocialAuthButtons } from "@feeblo/post-ui/social-auth-buttons";
import { TurnstileField, useTurnstile } from "@feeblo/post-ui/turnstile";
import {
  getSignUpErrorField,
  useSignUpEmail,
} from "@feeblo/post-ui/use-auth-submission";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { m } from "@/paraglide/messages";
import { AuthShell } from "~/features/auth/components/auth-shell";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search) =>
    z
      .object({
        redirectTo: z.string().optional(),
      })
      .parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate({ from: "/sign-up" });
  const search = Route.useSearch();
  const turnstile = useTurnstile();

  const signUp = useSignUpEmail({
    getCallbackURL: () => getSafeCallbackURL(search.redirectTo),
    getCaptchaToken: () => turnstile.token,
    onSuccess: async () => {
      // The root auth guard reads the atom's cached session. Without this
      // refresh it still holds the pre-sign-up null and would bounce the
      // newly authenticated user back to /sign-in instead of /register.
      //
      // Best-effort: a transient refresh failure must not surface the
      // completed sign-up as an error. The guard re-resolves on navigation
      // and fails open on its own transport errors.
      try {
        await refreshAuthSession();
      } catch {
        // Signed-in state lives in the HttpOnly cookie regardless.
      }
      await navigate({
        to: "/register",
      });
    },
    onVerifyEmail: () =>
      navigate({
        to: "/email-verify",
        search: {
          redirectTo: search.redirectTo,
        },
      }),
  });

  const form = useAppForm({
    ...signUpFormOpts,
    onSubmit: async ({ value }) => {
      form.setErrorMap({
        onSubmit: undefined,
      });

      if (turnstile.isEnabled && !turnstile.token) {
        form.setErrorMap({
          onSubmit: {
            fields: {
              email: {
                message: m.fable_quartz_sage(),
              },
            },
          },
        });
        return;
      }

      const result = await signUp({
        email: value.email,
        name: value.name,
        password: value.password,
      });

      turnstile.reset();

      if (result.type === "error") {
        const { message } = getSignUpErrorField(result.error);
        form.setErrorMap({
          onSubmit: {
            fields: {
              email: {
                message,
              },
            },
          },
        });
      }
    },
  });
  return (
    <AuthShell
      description={m.lark_opal_tundra()}
      footer={
        <div className="text-center text-sm">
          {m.ivory_jolly_vivid()}{" "}
          <Link className="underline underline-offset-4" to="/sign-in">
            {m.canyon_juniper_wharf()}
          </Link>
        </div>
      }
      title={m.oasis_orchard_wharf()}
    >
      <AuthForm form={form}>
        <SignUpFields
          disabled={turnstile.isEnabled && !turnstile.token}
          form={form}
          submitLabel={m.harbor_opal_prairie()}
        >
          <TurnstileField
            onError={turnstile.handleError}
            onExpire={turnstile.handleExpire}
            onSuccess={turnstile.handleSuccess}
            ref={turnstile.ref}
            siteKey={turnstile.siteKey}
          />
        </SignUpFields>
      </AuthForm>

      <SocialAuthButtons redirectTo={search.redirectTo} />
    </AuthShell>
  );
}
