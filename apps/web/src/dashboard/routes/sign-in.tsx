import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { EmailSchema, PasswordSchema } from "~/utils/user-validation";

export const Route = createFileRoute("/sign-in")({
  component: RouteComponent,
});

const FormSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

function RouteComponent() {
  const form = useAppForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onChange: FormSchema,
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email({
        email: value.email,
        password: value.password,
        callbackURL: "/",
      });
    },
  });

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-xl">Sign in</CardTitle>
            <p className="text-muted-foreground text-sm">
              Enter your account credentials to continue.
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
            >
              <div className="flex flex-col gap-4">
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

                <form.AppForm>
                  <form.SubscribeButton
                    className="w-full"
                    label="Login"
                    type="submit"
                  />
                </form.AppForm>

                <div className="text-center text-sm">
                  Don&apos;t have an account?{" "}
                  <Link className="underline underline-offset-4" to="/sign-up">
                    Sign up
                  </Link>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
