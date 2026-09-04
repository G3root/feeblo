import { getSafeCallbackURL } from "@feeblo/post-ui/auth-flows";
import {
  AuthForm,
  SignInFields,
  signInFormOpts,
} from "@feeblo/post-ui/auth-forms";
import { SocialAuthButtons } from "@feeblo/post-ui/social-auth-buttons";
import {
  getSignInErrorField,
  useSignInEmail,
} from "@feeblo/post-ui/use-auth-submission";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { m } from "@/paraglide/messages";
import { AuthShell } from "~/features/auth/components/auth-shell";

export const Route = createFileRoute("/sign-in")({
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
      description={m.hollow_umbra_lark()}
      footer={
        <div className="text-center text-sm">
          {m.basil_iris_fern()}{" "}
          <Link className="underline underline-offset-4" to="/sign-up">
            {m.ivory_kite_plume()}
          </Link>
        </div>
      }
      title={m.jolly_north_otter()}
    >
      <AuthForm form={form}>
        <SignInFields form={form} submitLabel={m.mellow_harbor_gentle()}>
          <Link
            className="text-muted-foreground text-sm underline underline-offset-4"
            search={{ redirectTo: search.redirectTo }}
            to="/forgot-password"
          >
            {m.amber_spruce_yarrow()}
          </Link>
        </SignInFields>
      </AuthForm>

      <SocialAuthButtons redirectTo={search.redirectTo} />
    </AuthShell>
  );
}
