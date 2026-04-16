import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { toastManager } from "~/components/ui/toast";
import { AuthShell } from "~/features/auth/components/auth-shell";
import { SocialAuthButtons } from "~/features/auth/components/social-auth-buttons";
import {
  getSafeCallbackURL,
  initializeEmailVerification,
} from "~/features/auth/lib/auth-flows";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import {
  EmailSchema,
  NameSchema,
  PasswordAndConfirmPasswordSchema,
} from "~/utils/user-validation";

export const Route = createFileRoute("/sign-up")({
  validateSearch: (search) =>
    z
      .object({
        redirectTo: z.string().optional(),
      })
      .parse(search),
  component: RouteComponent,
});

const FormSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
  })
  .and(PasswordAndConfirmPasswordSchema);

function RouteComponent() {
  const navigate = useNavigate({ from: "/sign-up" });
  const search = Route.useSearch();

  const form = useAppForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onSubmit: FormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.signUp.email({
        email: value.email,
        name: value.name,
        password: value.password,
        callbackURL: getSafeCallbackURL(search.redirectTo),
      });

      if (response.error) {
        toastManager.add({
          title: response.error.message,
          type: "error",
        });
        return;
      }

      const email = response.data?.user?.email ?? value.email;

      const isVerificationReady = await initializeEmailVerification(email);
      if (!isVerificationReady) {
        return;
      }

      navigate({
        to: "/email-verify",
        search: {
          redirectTo: search.redirectTo,
        },
      });
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
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <form.AppField
          children={(field) => <field.TextField label="Full Name" />}
          name="name"
        />

        <form.AppField
          children={(field) => <field.TextField label="Email" type="email" />}
          name="email"
        />

        <form.AppField
          children={(field) => (
            <field.TextField label="Password" type="password" />
          )}
          name="password"
        />

        <form.AppField
          children={(field) => (
            <field.TextField label="Confirm Password" type="password" />
          )}
          name="confirmPassword"
        />

        <form.AppForm>
          <form.SubscribeButton className="w-full" label="Sign up" />
        </form.AppForm>
      </form>

      <SocialAuthButtons mode="sign-up" redirectTo={search.redirectTo} />
    </AuthShell>
  );
}
