import {
  getSafeCallbackURL,
  initializeEmailVerification,
} from "@feeblo/post-ui/auth-flows";
import { SocialAuthButtons } from "@feeblo/post-ui/social-auth-buttons";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { authClient } from "@feeblo/web-shared/auth-client";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import {
  EmailSchema,
  NameSchema,
  PasswordAndConfirmPasswordSchema,
} from "@feeblo/web-shared/user-validation";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
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

const turnstileSiteKey = getRuntimePublicEnv().turnstileSiteKey;
const isTurnstileEnabled = !!turnstileSiteKey;

const FormSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
  })
  .and(PasswordAndConfirmPasswordSchema);

function RouteComponent() {
  const navigate = useNavigate({ from: "/sign-up" });
  const search = Route.useSearch();
  const turnstileRef = useRef<TurnstileInstance>(null);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

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
      form.setErrorMap({
        onSubmit: undefined,
      });

      if (isTurnstileEnabled && !turnstileToken) {
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

      try {
        const response = await authClient.signUp.email({
          email: value.email,
          name: value.name,
          password: value.password,
          callbackURL: getSafeCallbackURL(search.redirectTo),
          fetchOptions: turnstileToken
            ? {
                headers: {
                  "x-captcha-response": turnstileToken,
                },
              }
            : undefined,
        });

        const email = response.data?.user?.email ?? value.email;

        if (response.error) {
          switch (response.error.code) {
            case "EMAIL_NOT_VERIFIED": {
              const isVerificationReady =
                await initializeEmailVerification(email);
              if (!isVerificationReady) {
                return;
              }

              await navigate({
                to: "/email-verify",
                search: {
                  redirectTo: search.redirectTo,
                },
              });
              return;
            }
            case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL": {
              form.setErrorMap({
                onSubmit: {
                  fields: {
                    email: {
                      message: "A user with that email already exists",
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
            case "TEMPORARY_EMAIL_NOT_ALLOWED": {
              form.setErrorMap({
                onSubmit: {
                  fields: {
                    email: {
                      message: "Temporary email addresses are not allowed.",
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

        if (!response.data?.user.emailVerified) {
          const isVerificationReady = await initializeEmailVerification(email);
          if (!isVerificationReady) {
            return;
          }

          await navigate({
            to: "/email-verify",
            search: {
              redirectTo: search.redirectTo,
            },
          });
          return;
        }

        navigate({
          to: "/$organizationId/feedback",
          params: {
            organizationId: "",
          },
        });
      } catch (error) {
        form.setErrorMap({
          onSubmit: {
            fields: {
              email: {
                message:
                  error instanceof Error
                    ? error.message
                    : "Something went wrong",
              },
            },
          },
        });
      } finally {
        if (isTurnstileEnabled) {
          setTurnstileToken(null);
          turnstileRef.current?.reset();
        }
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

        {turnstileSiteKey ? (
          <Turnstile
            onError={() => {
              setTurnstileToken(null);
            }}
            onExpire={() => {
              setTurnstileToken(null);
              turnstileRef.current?.reset();
            }}
            onSuccess={(token) => {
              setTurnstileToken(token);
            }}
            options={{
              size: "flexible",
            }}
            ref={turnstileRef}
            siteKey={turnstileSiteKey}
          />
        ) : null}

        <form.AppForm>
          <form.SubscribeButton
            className="w-full"
            disabled={isTurnstileEnabled && !turnstileToken}
            label="Sign up"
          />
        </form.AppForm>
      </form>

      <SocialAuthButtons mode="sign-up" redirectTo={search.redirectTo} />
    </AuthShell>
  );
}
