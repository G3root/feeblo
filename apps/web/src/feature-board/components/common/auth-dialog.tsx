import { useCallback, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
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
import {
  EmailSchema,
  NameSchema,
  PasswordAndConfirmPasswordSchema,
  PasswordSchema,
} from "~/utils/user-validation";

interface AuthDialogProps {
  variant: "sign-in" | "sign-up";
}

type DialogStep =
  | { kind: "credentials" }
  | { kind: "otp-verification"; email: string; mode: "sign-in" | "sign-up" };

const SignInSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

const SignUpSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
  })
  .and(PasswordAndConfirmPasswordSchema);

const OtpSchema = z.object({
  otp: z.string().length(6, { message: "Verification code must be 6 digits" }),
});

export function AuthDialog({ variant }: AuthDialogProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<DialogStep>({ kind: "credentials" });
  const isSignIn = variant === "sign-in";

  const triggerLabel = useMemo(
    () => (isSignIn ? "Sign in" : "Sign up"),
    [isSignIn]
  );

  const headerTitle = useMemo(() => {
    if (step.kind === "otp-verification") {
      return "Verify your email";
    }
    return isSignIn ? "Sign in" : "Create account";
  }, [isSignIn, step]);

  const headerDescription = useMemo(() => {
    if (step.kind === "otp-verification") {
      return "Enter the 6‑digit code we just emailed you to activate your account.";
    }
    return isSignIn
      ? "Use your email and password to continue."
      : "Create an account to start collecting feedback.";
  }, [isSignIn, step]);

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setStep({ kind: "credentials" });
    }
  }, []);

  const handleVerify = useCallback(
    (email: string) => {
      setStep({
        kind: "otp-verification",
        email,
        mode: isSignIn ? "sign-in" : "sign-up",
      });
    },
    [isSignIn]
  );

  const handleSuccess = useCallback(() => {
    setOpen(false);
    setStep({ kind: "credentials" });
  }, []);

  return (
    <Dialog onOpenChange={handleOpenChange} open={open}>
      <DialogTrigger
        render={(props) => (
          <Button variant="secondary" {...props}>
            {triggerLabel}
          </Button>
        )}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{headerTitle}</DialogTitle>
          <p className="text-muted-foreground text-sm">{headerDescription}</p>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          {step.kind === "otp-verification" && (
            <OtpVerificationForm email={step.email} onSuccess={handleSuccess} />
          )}
          {step.kind === "credentials" && isSignIn && (
            <SignInForm onSuccess={handleSuccess} onVerify={handleVerify} />
          )}
          {step.kind === "credentials" && !isSignIn && (
            <SignUpForm onVerify={handleVerify} />
          )}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}

function SignInForm({
  onSuccess,
  onVerify,
}: { onSuccess: () => void; onVerify: (email: string) => void }) {
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: SignInSchema },
    onSubmit: async ({ value }) => {
      const response = await authClient.signIn.email({
        email: value.email,
        password: value.password,
        callbackURL: "/",
      });

      if (!response.error) {
        onSuccess();
        return;
      }

      if (response.error.code === "EMAIL_NOT_VERIFIED") {
        const otpRes = await fetch(verificationOtpEndpoint, {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: value.email,
            type: "email-verification",
          }),
        });
        if (!otpRes.ok) {
          toastManager.add({
            title: "Failed to initialize verification",
            type: "error",
          });
          return;
        }
        onVerify(value.email);
        return;
      }

      toastManager.add({
        title: response.error.message,
        type: "error",
      });
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
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
          label="Sign in"
          type="submit"
        />
      </form.AppForm>
    </form>
  );
}

function SignUpForm({
  onVerify,
}: { onVerify: (email: string) => void }) {
  const form = useAppForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: { onSubmit: SignUpSchema },
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
      const otpRes = await fetch(verificationOtpEndpoint, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          type: "email-verification",
        }),
      });

      if (!otpRes.ok) {
        toastManager.add({
          title: "Failed to initialize verification",
          type: "error",
        });
        return;
      }

      onVerify(email);
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <form.AppField
        children={(field) => <field.TextField label="Full name" />}
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
          <field.TextField label="Confirm password" type="password" />
        )}
        name="confirmPassword"
      />
      <form.AppForm>
        <form.SubscribeButton
          className="w-full"
          label="Sign up"
          type="submit"
        />
      </form.AppForm>
    </form>
  );
}

function OtpVerificationForm({
  email,
  onSuccess,
}: {
  email: string;
  onSuccess: () => void;
}) {
  const form = useAppForm({
    defaultValues: { otp: "" },
    validators: { onChange: OtpSchema },
    onSubmit: async ({ value }) => {
      const response = await authClient.emailOtp.verifyEmail({
        email,
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

      onSuccess();
      window.location.reload();
    },
  });

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
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
                  containerClassName="justify-center gap-4"
                  id={field.name}
                  maxLength={6}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onChange={(value) => field.handleChange(value)}
                  value={field.state.value}
                >
                  <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:h-14 *:data-[slot=input-otp-slot]:w-10 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-lg">
                    <InputOTPSlot index={0} />
                    <InputOTPSlot index={1} />
                    <InputOTPSlot index={2} />
                  </InputOTPGroup>
                  <InputOTPSeparator />
                  <InputOTPGroup className="gap-2.5 *:data-[slot=input-otp-slot]:h-14 *:data-[slot=input-otp-slot]:w-10 *:data-[slot=input-otp-slot]:rounded-md *:data-[slot=input-otp-slot]:border *:data-[slot=input-otp-slot]:text-lg">
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
                          email,
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
        <form.AppForm>
          <form.SubscribeButton
            className="w-full"
            label="Verify"
            type="submit"
          />
        </form.AppForm>
      </FieldGroup>
    </form>
  );
}
