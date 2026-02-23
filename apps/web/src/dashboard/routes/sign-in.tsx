import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
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
        <div className="flex flex-col gap-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <div className="flex flex-col gap-6">
              <div className="flex flex-col items-center gap-2">
                <Link
                  className="flex flex-col items-center gap-2 font-medium"
                  to="/"
                >
                  <span className="sr-only">Acme Inc.</span>
                </Link>
                <h1 className="font-bold text-xl">Welcome to Acme Inc.</h1>
                <div className="text-center text-sm">
                  Don&apos;t have an account?{" "}
                  <Link className="underline underline-offset-4" to="/sign-up">
                    Sign up
                  </Link>
                </div>
              </div>
              <div className="flex flex-col gap-6">
                <form.AppField
                  children={(field) => (
                    <field.TextField label="Email" type="email" />
                  )}
                  name="email"
                />

                <form.AppField
                  children={(field) => (
                    <field.TextField label="Password" type="text" />
                  )}
                  name="password"
                />

                <form.AppForm>
                  <form.SubscribeButton label="Login" type="submit" />
                </form.AppForm>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
