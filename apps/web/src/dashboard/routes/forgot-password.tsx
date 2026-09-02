import { initializePasswordReset } from "@feeblo/post-ui/auth-flows";
import {
  clearVerificationOtp,
  RateLimitErrorSchema,
} from "@feeblo/post-ui/otp-resend";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { authClient } from "@feeblo/web-shared/auth-client";
import { EmailSchema } from "@feeblo/web-shared/user-validation";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";

import { AuthShell } from "~/features/auth/components/auth-shell";
import { m } from "@/paraglide/messages";

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
                      message: m.dune_elm_jade(),
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
                      message: m.kelp_maple_nectar(),
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
                    message:
                      minutes === 1
                        ? m.cinder_drift_spruce({ minutes })
                        : m.lunar_mellow_yucca({ minutes }),
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
                    : m.acorn_husk_zinnia(),
              },
            },
          },
        });
      }
    },
  });

  return (
    <AuthShell
      description={m.estuary_quarry_sage()}
      footer={
        <div className="text-center text-sm">
          {m.glacier_mellow_prairie()}{" "}
          <Link className="underline underline-offset-4" to="/sign-in">
            {m.glade_marsh_moss()}
          </Link>
        </div>
      }
      title={m.lantern_quartz_river()}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
      >
        <div className="flex flex-col gap-4">
          <form.AppField name="email">
            {(field) => (
              <field.TextField label={m.boulder_glade_orbit()} type="email" />
            )}
          </form.AppField>

          <form.AppForm>
            <form.SubscribeButton
              className="w-full"
              label={m.elm_fable_upland()}
              type="submit"
            />
          </form.AppForm>
        </div>
      </form>
    </AuthShell>
  );
}
