import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient, verificationOtpEndpoint } from "~/lib/auth-client";
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
      onChange: FormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.signUp.email({
        email: value.email,
        name: value.name,
        password: value.password,
        callbackURL: "/",
      });

      if (response.error) {
        toastManager.add({
          title: response.error.message,
          type: "error",
        });
        return;
      }

      const email = response.data?.user?.email ?? value.email;

      const otpStateResponse = await fetch(verificationOtpEndpoint, {
        method: "POST",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email,
          type: "email-verification",
        }),
      });

      if (!otpStateResponse.ok) {
        toastManager.add({
          title: "Failed to initialize verification",
          type: "error",
        });
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
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Create account</CardTitle>
            <p className="text-muted-foreground text-sm">
              Start your workspace with a new account.
            </p>
          </CardHeader>
          <CardContent>
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
                children={(field) => (
                  <field.TextField label="Email" type="email" />
                )}
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

              <div className="text-center text-sm">
                Already have an account?{" "}
                <Link className="underline underline-offset-4" to="/sign-in">
                  Sign in
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
