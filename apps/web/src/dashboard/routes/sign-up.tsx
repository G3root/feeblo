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
      await refreshAuthSession();
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
      description="Start your workspace with a new account."
      footer={
        <div className="text-center text-sm">
          Already have an account?{" "}
          <Link className="underline underline-offset-4" to="/sign-in">
            Sign in
          </Link>
        </div>
      }
      title="Create account"
    >
      <AuthForm form={form}>
        <SignUpFields
          disabled={turnstile.isEnabled && !turnstile.token}
          form={form}
          submitLabel="Sign up"
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
