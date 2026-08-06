import { initializePasswordReset } from "@feeblo/post-ui/auth-flows";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { authClient } from "@feeblo/web-shared/auth-client";
import { EmailSchema } from "@feeblo/web-shared/user-validation";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AuthShell } from "~/features/auth/components/auth-shell";

export const Route = createFileRoute("/forgot-password")({
  component: RouteComponent,
});

const FormSchema = z.object({
  email: EmailSchema,
});

const RateLimitErrorSchema = z.object({
  code: z.literal("VERIFICATION_OTP_RATE_LIMITED"),
  retryAfterSeconds: z.number().int().positive(),
});

function RouteComponent() {
  const navigate = useNavigate({ from: "/forgot-password" });

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

      const isResetReady = await initializePasswordReset(value.email);
      if (!isResetReady) {
        return;
      }

      const response = await authClient.emailOtp.requestPasswordReset({
        email: value.email,
      });

      if (response.error) {
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

      await navigate({ to: "/reset-password" });
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
