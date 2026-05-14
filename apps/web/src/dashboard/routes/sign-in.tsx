import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AuthShell } from "~/features/auth/components/auth-shell";
import { SocialAuthButtons } from "~/features/auth/components/social-auth-buttons";
import {
  getSafeCallbackURL,
  initializeEmailVerification,
} from "~/features/auth/lib/auth-flows";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
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
      onSubmit: FormSchema,
    },
    onSubmit: async ({ value }) => {
      form.setErrorMap({
        onSubmit: undefined,
      });

      try {
        const response = await authClient.signIn.email({
          email: value.email,
          password: value.password,
          callbackURL: getSafeCallbackURL(search.redirectTo),
        });

        if (response.error) {
          switch (response.error.code) {
            case "EMAIL_NOT_VERIFIED": {
              const isVerificationReady = await initializeEmailVerification(
                value.email
              );
              if (!isVerificationReady) {
                return;
              }
              navigate({
                to: "/email-verify",
                search: {
                  redirectTo: search.redirectTo,
                },
              });
              break;
            }
            case "INVALID_EMAIL_OR_PASSWORD": {
              form.setErrorMap({
                onSubmit: {
                  fields: {
                    password: {
                      message: "Invalid email or password",
                    },
                  },
                },
              });
              return;
            }
            case "EMAIL_BLOCKED": {
              form.setErrorMap({
                onSubmit: {
                  fields: {
                    email: {
                      message: "Email is blocked.",
                    },
                  },
                },
              });
              return;
            }

            default:
              form.setErrorMap({
                onSubmit: {
                  fields: {
                    email: {
                      message: response.error.message,
                    },
                  },
                },
              });
              return;
          }
        }
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            fields: {
              email: {
                message:
                  error instanceof Error ? error.message : "Something went wrong",
              },
            },
          },
        });
      }
    },
  });

  return (
    <AuthShell
      description="Enter your account credentials to continue."
      footer={
        <div className="text-center text-sm">
          Don&apos;t have an account?{" "}
          <Link className="underline underline-offset-4" to="/sign-up">
            Sign up
          </Link>
        </div>
      }
      title="Sign in"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div className="flex flex-col gap-4">
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

          <form.AppForm>
            <form.SubscribeButton
              className="w-full"
              label="Login"
              type="submit"
            />
          </form.AppForm>
        </div>
      </form>

      <SocialAuthButtons mode="sign-in" redirectTo={search.redirectTo} />
    </AuthShell>
  );
}
