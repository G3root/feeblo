import { initializePasswordReset } from "@feeblo/post-ui/auth-flows";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { authClient } from "@feeblo/web-shared/auth-client";
import { EmailSchema } from "@feeblo/web-shared/user-validation";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AuthShell } from "~/features/auth/components/auth-shell";
import {
  clearVerificationOtp,
  RateLimitErrorSchema,
} from "~/features/auth/lib/otp-resend";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

export const Route = createFileRoute("/forgot-password")({
  validateSearch: (search) => SearchSchema.parse(search),
  component: RouteComponent,
});

const FormSchema = z.object({
  email: EmailSchema,
});

function RouteComponent() {
  const navigate = useNavigate({ from: "/forgot-password" });
  const search = Route.useSearch();

  const form = useAppForm({
    defaultValues: {
      email: "",
    },
    validators: {
      onSubmit: FormSchema,
    },
    onSubmit: async ({ value }) => {
      form.setErrorMap({
        onSubmit: undefined,
      });

      try {
        const isResetReady = await initializePasswordReset(value.email);
        if (!isResetReady) {
          await clearVerificationOtp(value.email, "reset-password");
          return;
        }

        const response = await authClient.emailOtp.requestPasswordReset({
          email: value.email,
        });

        if (response.error) {
          // The verification-otp cookie was set above; clear it so a later
          // visit to /reset-password doesn't surface a stale OTP screen.
          await clearVerificationOtp(value.email, "reset-password");

          switch (response.error.code) {
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
            default: {
              break;
            }
          }

          const rateLimitError = RateLimitErrorSchema.safeParse(response.error);
          if (rateLimitError.success) {
            const minutes = Math.max(
              1,
              Math.ceil(rateLimitError.data.retryAfterSeconds / 60)
            );
            form.setErrorMap({
              onSubmit: {
                fields: {
                  email: {
                    message: `Too many reset requests. Please try again in ${minutes} ${
                      minutes === 1 ? "minute" : "minutes"
                    }.`,
                  },
                },
              },
            });
            return;
          }

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

        await navigate({
          to: "/reset-password",
          search: { redirectTo: search.redirectTo },
        });
      } catch (error) {
        // The verification-otp cookie may have been set above; clear it so a
        // later visit to /reset-password doesn't surface a stale OTP screen.
        await clearVerificationOtp(value.email, "reset-password");
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
      }
    },
  });

  return (
    <AuthShell
      description="Enter your account email and we'll send you a code to reset your password."
      footer={
        <div className="text-center text-sm">
          Remembered your password?{" "}
          <Link className="underline underline-offset-4" to="/sign-in">
            Sign in
          </Link>
        </div>
      }
      title="Forgot password"
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

          <form.AppForm>
            <form.SubscribeButton
              className="w-full"
              label="Send reset code"
              type="submit"
            />
          </form.AppForm>
        </div>
      </form>
    </AuthShell>
  );
}
