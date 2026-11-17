import { getSafeCallbackURL } from "@feeblo/post-ui/auth-flows";
import { AuthForm, signInFormOpts } from "@feeblo/post-ui/auth-forms";
import { useLastAuthMethod } from "@feeblo/post-ui/last-auth-method";
import { LastUsedBadge } from "@feeblo/post-ui/last-used-badge";
import { SocialAuthButtons } from "@feeblo/post-ui/social-auth-buttons";
import {
  getSignInErrorField,
  useSignInEmail,
} from "@feeblo/post-ui/use-auth-submission";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AuthDivider } from "~/features/auth/components/auth-divider";
import { AuthShell } from "~/features/auth/components/auth-shell";

export const Route = createFileRoute("/_auth/sign-in")({
  validateSearch: (search) =>
    z
      .object({
        redirectTo: z.string().optional(),
      })
      .parse(search),
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate({ from: "/sign-in" });
  const search = Route.useSearch();
  const lastUsedMethod = useLastAuthMethod();

  const signIn = useSignInEmail({
    getCallbackURL: () => getSafeCallbackURL(search.redirectTo),
    onEmailNotVerified: () =>
      navigate({
        to: "/email-verify",
        search: {
          redirectTo: search.redirectTo,
        },
      }),
  });

  const form = useAppForm({
    ...signInFormOpts,
    onSubmit: async ({ value }) => {
      form.setErrorMap({
        onSubmit: undefined,
      });

      const result = await signIn({
        email: value.email,
        password: value.password,
      });

      if (result.type === "error") {
        const { field, message } = getSignInErrorField(result.error);
        form.setErrorMap({
          onSubmit: {
            fields:
              field === "password"
                ? { password: { message } }
                : { email: { message } },
          },
        });
      }
    },
  });

  return (
    <AuthShell
      description="Sign in to pick up where your workspace left off."
      footer={
        <p>
          New to Feeblo?{" "}
          <Link
            className="text-foreground font-medium underline-offset-4 hover:underline"
            search={{ redirectTo: search.redirectTo }}
            to="/sign-up"
          >
            Create an account
          </Link>
        </p>
      }
      title="Welcome back"
    >
      <div className="flex flex-col gap-6">
        <SocialAuthButtons
          lastUsedMethod={lastUsedMethod}
          redirectTo={search.redirectTo}
        />

        <AuthDivider>or use email</AuthDivider>

        <AuthForm form={form}>
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

          {/* Placed over the field rather than inside it: `<label>` wraps a
              link that would then focus the input as well as navigate, and a
              row of its own pushes the primary action 40px further down. */}
          <div className="relative">
            <form.AppField name="password">
              {(field) => (
                <field.PasswordField
                  autoComplete="current-password"
                  label="Password"
                  size="lg"
                />
              )}
            </form.AppField>
            <Link
              className="text-muted-foreground hover:text-foreground absolute top-0 right-0 text-[13px] leading-4 underline-offset-4 transition-colors duration-150 hover:underline"
              search={{ redirectTo: search.redirectTo }}
              to="/forgot-password"
            >
              Forgot password?
            </Link>
          </div>

          <form.AppForm>
            <form.SubscribeButton
              className="relative w-full overflow-visible"
              size="lg"
              type="submit"
            >
              Sign in
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
