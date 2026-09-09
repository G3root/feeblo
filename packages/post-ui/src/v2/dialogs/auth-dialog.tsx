import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { FieldSeparator } from "@feeblo/ui/field";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { authClient } from "@feeblo/web-shared/auth-client";
import { refreshAuthSession } from "@feeblo/web-shared/auth-session";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";
import { useCallback, useState } from "react";

import { getSafeCallbackURL } from "../../auth/auth-flows";
import {
  AuthForm,
  OtpFormFields,
  OtpResend,
  otpFormOpts,
  SignInFields,
  signInFormOpts,
  SignUpFields,
  signUpFormOpts,
} from "../../auth/auth-forms";
import { toResendResult } from "../../auth/otp-resend";
import { SocialAuthButtons } from "../../auth/social-auth-buttons";
import { TurnstileField, useTurnstile } from "../../auth/turnstile";
import {
  useSignInEmail,
  useSignUpEmail,
  useVerifyEmailOtp,
} from "../../auth/use-auth-submission";
import { m } from "../../paraglide/messages.js";
import { useAuthDialogContext } from "../dialog-stores/auth";

type EmailStep = "email-sign-in" | "email-sign-up";

type DialogStep =
  | { kind: "chooser" }
  | { kind: EmailStep }
  | { kind: "otp-verification"; email: string; previous: EmailStep };

const CHOOSER_STEP: DialogStep = { kind: "chooser" };

export function AuthButton() {
  const store = useAuthDialogContext();

  return (
    <Button
      onClick={() => store.send({ type: "setOpen", open: true })}
      type="button"
      variant="secondary"
    >
      {m.ok_jumpy_cobra()}
    </Button>
  );
}

export function AuthDialogRoot() {
  const store = useAuthDialogContext();
  const isOpen = useSelector(store, (state) => state.context.open);

  const [step, setStep] = useState<DialogStep>(CHOOSER_STEP);

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
              {m.dizzy_lower_baboon()}
            </Button>
          ) : null}
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-5">
          {step.kind === "chooser" ? (
            <AuthMethodChooser onSelectEmailStep={handleSelectEmailStep} />
          ) : null}
          {step.kind === "email-sign-in" ? (
            <SignInForm
              onSuccess={handleSuccess}
              onVerify={(email) => handleVerify(email, "email-sign-in")}
            />
          ) : null}
          {step.kind === "email-sign-up" ? (
            <SignUpForm
              onSuccess={handleSuccess}
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
        title: m.ok_jumpy_cobra(),
      };
    case "email-sign-in":
      return {
        title: m.stock_such_porpoise(),
        description: m.awake_tidy_antelope(),
      };
    case "email-sign-up":
      return {
        title: m.extra_born_bear(),
        description: m.agent_smart_cat(),
      };
    case "otp-verification":
      return {
        title: m.still_white_dachshund(),
        description: m.north_tiny_pelican(),
      };
  }
}

function AuthMethodChooser({
  onSelectEmailStep,
}: {
  onSelectEmailStep: (step: EmailStep) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <SocialAuthButtons />
      <FieldSeparator>{m.stout_teary_dove()}</FieldSeparator>

      <Button onClick={() => onSelectEmailStep("email-sign-in")}>
        {m.stock_such_porpoise()}
      </Button>

      <Button onClick={() => onSelectEmailStep("email-sign-up")}>
        {m.extra_born_bear()}
      </Button>
    </div>
  );
}

function showAuthError(message?: string | null) {
  toastManager.add({
    title: message ?? m.every_salty_antelope(),
    type: "error",
  });
}

function SignInForm({
  onSuccess,
  onVerify,
}: {
  onSuccess: () => void;
  onVerify: (email: string) => void;
}) {
  const signIn = useSignInEmail({
    getCallbackURL: () => getSafeCallbackURL(),
    onEmailNotVerified: onVerify,
    onSuccess,
  });

  const form = useAppForm({
    ...signInFormOpts,
    onSubmit: async ({ value }) => {
      const result = await signIn({
        email: value.email ?? "",
        password: value.password,
      });

      if (result.type === "error") {
        showAuthError(result.error.message);
      }
    },
  });

  return (
    <AuthForm form={form}>
      <SignInFields form={form} submitLabel={m.salty_few_seal()}>
        <a
          className="text-muted-foreground text-sm underline underline-offset-4"
          href={`${getRuntimePublicEnv().appUrl ?? ""}/forgot-password`}
          rel="noreferrer"
          target="_blank"
        >
          {m.fit_close_crossbill()}
        </a>
      </SignInFields>
    </AuthForm>
  );
}

function SignUpForm({
  onSuccess,
  onVerify,
}: {
  onSuccess: () => void;
  onVerify: (email: string) => void;
}) {
  const turnstile = useTurnstile();
  const signUp = useSignUpEmail({
    getCallbackURL: () => getSafeCallbackURL(),
    getCaptchaToken: () => turnstile.token,
    onSuccess,
    onVerifyEmail: onVerify,
  });

  const form = useAppForm({
    ...signUpFormOpts,
    onSubmit: async ({ value }) => {
      if (turnstile.isEnabled && !turnstile.token) {
        showAuthError(m.small_round_lemming());
        return;
      }

      const result = await signUp({
        email: value.email ?? "",
        name: value.name,
        password: value.password,
      });

      turnstile.reset();

      if (result.type === "error") {
        showAuthError(result.error.message);
      }
    },
  });

  return (
    <AuthForm form={form}>
      <SignUpFields
        disabled={turnstile.isEnabled && !turnstile.token}
        form={form}
        submitLabel={m.mealy_patchy_shrimp()}
      >
        <TurnstileField
          onError={turnstile.handleError}
          onExpire={turnstile.handleExpire}
          onSuccess={turnstile.handleSuccess}
          ref={turnstile.ref}
          siteKey={turnstile.siteKey}
        />
      </SignUpFields>
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
  const verifyOtp = useVerifyEmailOtp({
    email,
    onSuccess: () => {
      onSuccess();
      window.location.reload();
    },
  });

  const resend = useCallback(async () => {
    const response = await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "email-verification",
    });

    if (response.error) {
      return toResendResult(response.error);
    }

    return { success: true as const };
  }, [email]);

  const form = useAppForm({
    ...otpFormOpts,
    onSubmit: async ({ value }) => {
      await verifyOtp(value.otp);
    },
  });

  return (
    <AuthForm form={form}>
      <OtpFormFields form={form} submitLabel={m.kind_less_vole()}>
        <OtpResend onResend={resend} successMessage={m.honest_dry_skunk()} />
      </OtpFormFields>
    </AuthForm>
  );
}
