import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient, verificationOtpEndpoint } from "~/lib/auth-client";
import { EmailSchema, PasswordSchema } from "~/utils/user-validation";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search) =>
    z
      .object({
        redirectTo: z.string().optional(),
      })
      .parse(search),
  component: RouteComponent,
});

const FormSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

function RouteComponent() {
  const navigate = useNavigate({ from: "/sign-in" });
  const search = Route.useSearch();

  const form = useAppForm({
    defaultValues: {
      email: "",
      password: "",
    },
    validators: {
      onChange: FormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.signIn.email({
        email: value.email,
        password: value.password,
        callbackURL: "/",
      });

      if (!response.error) {
        return;
      }

      if (response.error.code === "EMAIL_NOT_VERIFIED") {
        const otpStateResponse = await fetch(verificationOtpEndpoint, {
          method: "POST",
          credentials: "include",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            email: value.email,
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
        return;
      }

      toastManager.add({
        title: response.error.message,
        type: "error",
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
