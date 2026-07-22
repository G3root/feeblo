/** biome-ignore-all lint/style/noNestedTernary: Keeps the auth action ordering compact. */
/** biome-ignore-all lint/style/useDefaultSwitchClause: DialogStep is an exhaustive union. */

import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
} from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from "@feeblo/ui/otp-field";
import { toastManager } from "@feeblo/ui/toast";
import {
  authClient,
  verificationOtpEndpoint,
} from "@feeblo/web-shared/auth-client";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
import {
  EmailSchema,
  NameSchema,
  PasswordAndConfirmPasswordSchema,
  PasswordSchema,
} from "@feeblo/web-shared/user-validation";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { getSafeCallbackURL } from "../../auth/auth-flows";
import { SocialAuthButtons } from "../../auth/social-auth-buttons";
import {
  type AuthDialogVariant,
  useAuthDialogContext,
} from "../dialog-stores/auth";

interface AuthDialogProps {
  variant: AuthDialogVariant;
}

type EmailStep = "email-sign-in" | "email-sign-up";

type DialogStep =
  | { kind: "chooser" }
  | { kind: EmailStep }
  | { kind: "otp-verification"; email: string; previous: EmailStep };

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

const CHOOSER_STEP: DialogStep = { kind: "chooser" };

export function AuthDialog({ variant }: AuthDialogProps) {
  const store = useAuthDialogContext();
  const triggerLabel = variant === "sign-in" ? "Sign in" : "Sign up";

  return (
    <Button
      onClick={() =>
        store.send({ type: "setOpen", open: true, data: { variant } })
      }
      type="button"
      variant="secondary"
    >
      {triggerLabel}
    </Button>
  );
}

export function AuthDialogRoot() {
  const store = useAuthDialogContext();
  const isOpen = useSelector(store, (state) => state.context.open);
  const variant = useSelector(
    store,
    (state) => state.context.data.variant ?? "sign-in"
  );
  const [step, setStep] = useState<DialogStep>(CHOOSER_STEP);

  const preferredEmailStep: EmailStep =
    variant === "sign-in" ? "email-sign-in" : "email-sign-up";

  const { title, description } = getStepCopy(step);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        store.send({ type: "setOpen", open: false });
        setStep(CHOOSER_STEP);
      }
    },
    [store]
  );

  const handleVerify = useCallback((email: string, previous: EmailStep) => {
    setStep({
      kind: "otp-verification",
      email,
      previous,
    });
  }, []);

  const handleSuccess = useCallback(() => {
    void refreshAuthSession();
    store.send({ type: "setOpen", open: false });
    setStep(CHOOSER_STEP);
  }, [store]);

  const handleSelectEmailStep = useCallback((nextStep: EmailStep) => {
    setStep({ kind: nextStep });
  }, []);

  const handleBack = useCallback(() => {
    if (step.kind === "otp-verification") {
      setStep({ kind: step.previous });
      return;
    }

    setStep(CHOOSER_STEP);
  }, [step]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the dialog step whenever the store opens or switches variant.
  useEffect(() => {
    setStep(CHOOSER_STEP);
  }, [variant, isOpen]);

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      <DialogPopup>
        <DialogHeader>
          {step.kind !== "chooser" ? (
            <Button
              className="mb-1 -ml-2 w-fit"
              onClick={handleBack}
              size="sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} />
              Back
            </Button>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          {step.kind === "chooser" ? (
            <AuthMethodChooser
              onSelectEmailStep={handleSelectEmailStep}
              preferredEmailStep={preferredEmailStep}
              socialMode={variant}
            />
          ) : null}
          {step.kind === "email-sign-in" ? (
            <SignInForm
              onSuccess={handleSuccess}
              onVerify={(email) => handleVerify(email, "email-sign-in")}
            />
          ) : null}
          {step.kind === "email-sign-up" ? (
            <SignUpForm
              onVerify={(email) => handleVerify(email, "email-sign-up")}
            />
          ) : null}
          {step.kind === "otp-verification" ? (
            <OtpVerificationForm email={step.email} onSuccess={handleSuccess} />
          ) : null}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

function getStepCopy(step: DialogStep) {
  switch (step.kind) {
    case "chooser":
      return {
        title: "Continue to Feeblo",
        description:
          "Choose how you want to get into your account or create a new one.",
      };
    case "email-sign-in":
      return {
        title: "Sign in with email",
        description: "Use your email and password to continue.",
      };
    case "email-sign-up":
      return {
        title: "Sign up with email",
        description: "Create an account to start collecting feedback.",
      };
    case "otp-verification":
      return {
        title: "Verify your email",
        description:
          "Enter the 6-digit code we just emailed you to activate your account.",
      };
  }
}

function AuthMethodChooser({
  onSelectEmailStep,
  preferredEmailStep,
  socialMode,
}: {
  onSelectEmailStep: (step: EmailStep) => void;
  preferredEmailStep: EmailStep;
  socialMode: "sign-in" | "sign-up";
}) {
  const actions = getEmailChooserActions(preferredEmailStep);

  return (
    <div className="flex flex-col gap-3">
      {actions.map((action) => (
        <Button
          autoFocus={action.step === preferredEmailStep}
          className="!h-auto w-full flex-col items-start gap-1.5 whitespace-normal rounded-2xl px-4 py-3 text-left"
          key={action.label}
          onClick={() => onSelectEmailStep(action.step)}
          type="button"
          variant={action.variant}
        >
          <span>{action.label}</span>
          <span className="font-normal text-current/70 text-sm">
            {action.description}
          </span>
        </Button>
      ))}
      <SocialAuthButtons mode={socialMode} />
    </div>
  );
}

function getEmailChooserActions(preferredEmailStep: EmailStep) {
  const baseActions: Array<{
    description: string;
    label: string;
    step: EmailStep;
  }> = [
    {
      description: "Use your email address and password.",
      label: "Sign in with email",
      step: "email-sign-in",
    },
    {
      description: "Create a new account with your email.",
      label: "Sign up with email",
      step: "email-sign-up",
    },
  ];

  return baseActions
    .toSorted((a, b) =>
      a.step === preferredEmailStep ? -1 : b.step === preferredEmailStep ? 1 : 0
    )
    .map((action) => ({
      ...action,
      variant:
        action.step === preferredEmailStep
          ? ("default" as const)
          : ("outline" as const),
    }));
}

async function initializeVerification(email: string) {
  const response = await fetch(verificationOtpEndpoint, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email,
      type: "email-verification",
    }),
  });

  if (response.ok) {
    return true;
  }

  toastManager.add({
    title: "Failed to initialize verification",
    type: "error",
  });
  return false;
}

function showAuthError(message?: string | null) {
  toastManager.add({
    title: message ?? "Something went wrong",
    type: "error",
  });
}

function AuthForm({
  children,
  form,
}: {
  children: React.ReactNode;
  form: { handleSubmit: () => void };
}) {
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      {children}
    </form>
  );
}

function SignInForm({
  onSuccess,
  onVerify,
}: {
  onSuccess: () => void;
  onVerify: (email: string) => void;
}) {
  const form = useAppForm({
    defaultValues: { email: "", password: "" },
    validators: { onSubmit: SignInSchema },
    onSubmit: async ({ value }) => {
      const email = value.email ?? "";
      const response = await authClient.signIn.email({
        email,
        password: value.password,
        callbackURL: getSafeCallbackURL(),
      });

      if (!response.error) {
        onSuccess();
        return;
      }

      if (response.error.code === "EMAIL_NOT_VERIFIED") {
        const isVerificationReady = await initializeVerification(email);
        if (!isVerificationReady) {
          return;
        }
        onVerify(email);
        return;
      }

      showAuthError(response.error.message);
    },
  });

  return (
    <AuthForm form={form}>
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
    </AuthForm>
  );
}

function SignUpForm({ onVerify }: { onVerify: (email: string) => void }) {
  const form = useAppForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: { onSubmit: SignUpSchema },
    onSubmit: async ({ value }) => {
      const email = value.email ?? "";
      const response = await authClient.signUp.email({
        email,
        name: value.name,
        password: value.password,
        callbackURL: getSafeCallbackURL(),
      });

      if (response.error) {
        showAuthError(response.error.message);
        return;
      }

      const verificationEmail = response.data?.user?.email ?? email;
      const isVerificationReady =
        await initializeVerification(verificationEmail);
      if (!isVerificationReady) {
        return;
      }

      onVerify(verificationEmail);
    },
  });

  return (
    <AuthForm form={form}>
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
    </AuthForm>
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
    <AuthForm form={form}>
      <FieldGroup>
        <form.Field
          children={(field) => {
            const isInvalid =
              field.state.meta.isTouched && !field.state.meta.isValid;
            return (
              <Field data-invalid={isInvalid}>
                <OTPField
                  aria-label="Verification code"
                  className="justify-center gap-4"
                  id={field.name}
                  length={6}
                  name={field.name}
                  onBlur={field.handleBlur}
                  onValueChange={(value) => field.handleChange(value)}
                  size="lg"
                  value={field.state.value}
                >
                  <OTPFieldInput />
                  <OTPFieldInput aria-label="Character 2 of 6" />
                  <OTPFieldInput aria-label="Character 3 of 6" />
                  <OTPFieldSeparator />
                  <OTPFieldInput aria-label="Character 4 of 6" />
                  <OTPFieldInput aria-label="Character 5 of 6" />
                  <OTPFieldInput aria-label="Character 6 of 6" />
                </OTPField>
                {isInvalid ? (
                  <FieldError errors={field.state.meta.errors} />
                ) : null}
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
                        showAuthError(response.error.message);
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
    </AuthForm>
  );
}
