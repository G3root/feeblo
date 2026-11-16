import { getSafeCallbackURL } from "@feeblo/post-ui/auth-flows";
import { AuthForm, signUpFormOpts } from "@feeblo/post-ui/auth-forms";
import { useLastAuthMethod } from "@feeblo/post-ui/last-auth-method";
import { LastUsedBadge } from "@feeblo/post-ui/last-used-badge";
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

import { AuthDivider } from "~/features/auth/components/auth-divider";
import { AuthShell } from "~/features/auth/components/auth-shell";

export const Route = createFileRoute("/_auth/sign-up")({
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
  const lastUsedMethod = useLastAuthMethod();
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

      if (search.redirectTo !== undefined) {
        // A deep link — an invitation — must survive sign-up and is already
        // on the right host. `getSafeCallbackURL` rejects protocol-relative
        // and absolute values, so an attacker-supplied search param cannot
        // turn this into an open redirect.
        window.location.assign(getSafeCallbackURL(search.redirectTo));

        return;
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
                message: "Please complete the security verification",
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
      description="Start collecting feedback in a few minutes."
      footer={
        <p>
          Already have an account?{" "}
          <Link
            className="text-foreground font-medium underline-offset-4 hover:underline"
            search={{ redirectTo: search.redirectTo }}
            to="/sign-in"
          >
            Sign in
          </Link>
        </p>
      }
      title="Create your account"
    >
      <div className="flex flex-col gap-6">
        <SocialAuthButtons
          lastUsedMethod={lastUsedMethod}
          redirectTo={search.redirectTo}
        />

        <AuthDivider>or sign up with email</AuthDivider>

        <AuthForm form={form}>
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                autoComplete="name"
                label="Full name"
                placeholder="Maya Robertson"
                size="lg"
              />
            )}
          </form.AppField>

          <form.AppField name="email">
            {(field) => (
              <field.TextField
                autoComplete="email"
                label="Email"
                placeholder="you@company.com"
                size="lg"
                type="email"
              />
            )}
          </form.AppField>

          <form.AppField name="password">
            {(field) => (
              <field.PasswordField
                autoComplete="new-password"
                label="Password"
                size="lg"
              />
            )}
          </form.AppField>

          <form.AppField name="confirmPassword">
            {(field) => (
              <field.PasswordField
                autoComplete="new-password"
                label="Confirm password"
                size="lg"
              />
            )}
          </form.AppField>

          <TurnstileField
            onError={turnstile.handleError}
            onExpire={turnstile.handleExpire}
            onSuccess={turnstile.handleSuccess}
            ref={turnstile.ref}
            siteKey={turnstile.siteKey}
          />

          <form.AppForm>
            <form.SubscribeButton
              className="relative w-full overflow-visible"
              disabled={turnstile.isEnabled && !turnstile.token}
              size="lg"
              type="submit"
            >
              Create account
              {lastUsedMethod === "email" ? (
                <LastUsedBadge tone="onBrand" />
              ) : null}
            </form.SubscribeButton>
          </form.AppForm>
        </AuthForm>
      </div>
    </AuthShell>
  );
}
