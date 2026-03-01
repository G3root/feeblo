import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "~/components/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "~/components/ui/input-otp";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient, verificationOtpEndpoint } from "~/lib/auth-client";

const SearchSchema = z.object({
  redirectTo: z.string().optional(),
});

const FormSchema = z.object({
  otp: z.string().length(6, { message: "Verification code must be 6 digits" }),
});

export const Route = createFileRoute("/email-verify")({
  validateSearch: (search) => SearchSchema.parse(search),
  loader: async () => {
    const response = await fetch(verificationOtpEndpoint, {
      credentials: "include",
    });

    if (!response.ok) {
      throw redirect({
        to: "/sign-up",
      });
    }

    const parsed = z
      .object({
        email: z.email(),
        type: z.enum(["email-verification", "reset-password"]),
      })
      .safeParse(await response.json());

    if (!parsed.success || parsed.data.type !== "email-verification") {
      throw redirect({
        to: "/sign-up",
      });
    }

    return parsed.data;
  },
  component: RouteComponent,
});

function RouteComponent() {
  const search = Route.useSearch();
  const verificationState = Route.useLoaderData();

  const form = useAppForm({
    defaultValues: {
      otp: "",
    },
    validators: {
      onChange: FormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.emailOtp.verifyEmail({
        email: verificationState.email,
        otp: value.otp,
      });

      if (response.error) {
        toastManager.add({
          title:
            response.error.code === "INVALID_OTP"
              ? "Invalid verification code"
              : response.error.message,
          type: "error",
        });
        return;
      }

      toastManager.add({
        title: "Email verified",
        type: "success",
      });

      await fetch(verificationOtpEndpoint, {
        method: "DELETE",
        credentials: "include",
      });

      const redirectTo = search.redirectTo?.startsWith("/")
        ? search.redirectTo
        : "/";

      window.location.href = redirectTo;
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
            <FieldGroup>
              <div className="flex flex-col items-center gap-2 text-center">
                <Link
                  className="flex flex-col items-center gap-2 font-medium"
                  to="/sign-up"
                >
                  <span className="flex size-8 items-center justify-center rounded-md">
                    {/* <IconKeyframes aria-hidden="true" className="size-6" /> */}
                  </span>
                  <span className="sr-only">Acme Inc.</span>
                </Link>
                <h1 className="font-bold text-xl">Enter verification code</h1>
                <FieldDescription>
                  We sent a 6-digit code to your email address
                </FieldDescription>
              </div>
              <form.Field
                children={(field) => {
                  const isInvalid =
                    field.state.meta.isTouched && !field.state.meta.isValid;
                  return (
                    <Field data-invalid={isInvalid}>
                      <FieldLabel className="sr-only" htmlFor={field.name}>
                        Verification code
                      </FieldLabel>
                      <InputOTP
                        containerClassName="gap-4"
                        id={field.name}
                        maxLength={6}
                        name={field.name}
                        onBlur={field.handleBlur}
                        onChange={(value) => field.handleChange(value)}
                        value={field.state.value}
                      >
                        <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:h-16 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-xl">
                          <InputOTPSlot index={0} />
                          <InputOTPSlot index={1} />
                          <InputOTPSlot index={2} />
                        </InputOTPGroup>
                        <InputOTPSeparator />
                        <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:h-16 *:data-[slot=input-otp-slot]:w-12 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-xl">
                          <InputOTPSlot index={3} />
                          <InputOTPSlot index={4} />
                          <InputOTPSlot index={5} />
                        </InputOTPGroup>
                      </InputOTP>
                      {isInvalid && (
                        <FieldError errors={field.state.meta.errors} />
                      )}
                      <FieldDescription className="text-center">
                        Didn&apos;t receive the code?
                        <Button
                          onClick={async (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const response =
                              await authClient.emailOtp.sendVerificationOtp({
                                email: verificationState.email,
                                type: "email-verification",
                              });
                            if (response.error) {
                              toastManager.add({
                                title: response.error.message,
                                type: "error",
                              });
                              return;
                            }
                            toastManager.add({
                              title: "Verification code sent",
                              type: "success",
                            });
                          }}
                          type="button"
                          variant="link"
                        >
                          Resend
                        </Button>
                      </FieldDescription>
                    </Field>
                  );
                }}
                name="otp"
              />

              <Field>
                <Button type="submit">Verify</Button>
              </Field>
            </FieldGroup>
          </form>
          <FieldDescription className="px-6 text-center">
            By clicking continue, you agree to our{" "}
            <Link to="/sign-up">Terms of Service</Link> and{" "}
            <Link to="/sign-up">Privacy Policy</Link>.
          </FieldDescription>
        </div>
      </div>
    </div>
  );
}
