import { Button } from "@feeblo/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import {
  OTPField,
  OTPFieldInput,
  OTPFieldSeparator,
} from "@feeblo/ui/otp-field";
import {
  EmailSchema,
  NameSchema,
  PasswordAndConfirmPasswordSchema,
  PasswordSchema,
} from "@feeblo/web-shared/user-validation";
import { formOptions } from "@tanstack/react-form";
import { type FormEvent, type ReactNode, useCallback } from "react";
import { z } from "zod";

import { getResendLabel, type ResendResult, useOtpResend } from "./otp-resend";

export const SignInSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

export const SignUpSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
  })
  .and(PasswordAndConfirmPasswordSchema);

export const OtpSchema = z.object({
  otp: z.string().length(6, { message: "Verification code must be 6 digits" }),
});

export const signInFormOpts = formOptions({
  defaultValues: {
    email: "",
    password: "",
  },
  validators: {
    onSubmit: SignInSchema,
  },
});

export const signUpFormOpts = formOptions({
  defaultValues: {
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
  },
  validators: {
    onSubmit: SignUpSchema,
  },
});

export const otpFormOpts = formOptions({
  defaultValues: {
    otp: "",
  },
  validators: {
    onChange: OtpSchema,
  },
});

export function AuthForm({
  children,
  form,
}: {
  children: ReactNode;
  form: { handleSubmit: () => void };
}) {
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      event.stopPropagation();
      form.handleSubmit();
    },
    [form]
  );

  return (
    <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
      {children}
    </form>
  );
}

interface SignInFieldsProps {
  submitLabel?: string;
}

const signInFieldsProps: SignInFieldsProps = {
  submitLabel: "Sign in",
};

export const SignInFields = withForm({
  ...signInFormOpts,
  props: signInFieldsProps,
  render: ({ form, submitLabel, children }) => (
    <>
      <form.AppField name="email">
        {(field) => <field.TextField label="Email" type="email" />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => <field.PasswordField label="Password" />}
      </form.AppField>
      {children ? <div className="flex justify-end">{children}</div> : null}
      <form.AppForm>
        <form.SubscribeButton
          className="w-full"
          label={submitLabel}
          type="submit"
        />
      </form.AppForm>
    </>
  ),
});

interface SignUpFieldsProps {
  disabled?: boolean;
  submitLabel?: string;
}

const signUpFieldsProps: SignUpFieldsProps = {
  disabled: false,
  submitLabel: "Sign up",
};

export const SignUpFields = withForm({
  ...signUpFormOpts,
  props: signUpFieldsProps,
  render: ({ form, disabled, submitLabel, children }) => (
    <>
      <form.AppField name="name">
        {(field) => <field.TextField label="Full Name" />}
      </form.AppField>
      <form.AppField name="email">
        {(field) => <field.TextField label="Email" type="email" />}
      </form.AppField>
      <form.AppField name="password">
        {(field) => <field.PasswordField label="Password" />}
      </form.AppField>
      <form.AppField name="confirmPassword">
        {(field) => <field.PasswordField label="Confirm Password" />}
      </form.AppField>
      {children}
      <form.AppForm>
        <form.SubscribeButton
          className="w-full"
          disabled={disabled}
          label={submitLabel}
          type="submit"
        />
      </form.AppForm>
    </>
  ),
});

interface OtpFormFieldsProps {
  submitLabel?: string;
}

const otpFormFieldsProps: OtpFormFieldsProps = {
  submitLabel: "Verify",
};

export const OtpFormFields = withForm({
  ...otpFormOpts,
  props: otpFormFieldsProps,
  render: ({ form, submitLabel, children }) => (
    <>
      <form.Field name="otp">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && !field.state.meta.isValid;
          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel className="sr-only" htmlFor={field.name}>
                Verification code
              </FieldLabel>
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
              {children}
            </Field>
          );
        }}
      </form.Field>
      <form.AppForm>
        <form.SubscribeButton
          className="w-full"
          label={submitLabel}
          type="submit"
        />
      </form.AppForm>
    </>
  ),
});

export function OtpResend({
  onResend,
  successMessage,
}: {
  onResend: () => Promise<ResendResult>;
  successMessage: string;
}) {
  const { cooldown, isResending, resend } = useOtpResend({
    onResend,
    successMessage,
  });

  return (
    <FieldDescription className="text-center">
      Didn&apos;t receive the code?
      <Button
        disabled={cooldown > 0 || isResending}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void resend();
        }}
        type="button"
        variant="link"
      >
        {getResendLabel({ cooldown, isResending })}
      </Button>
      <span className="sr-only" role="timer">
        {cooldown > 0
          ? `You can request another code in ${cooldown} seconds`
          : "You can request another code now"}
      </span>
    </FieldDescription>
  );
}
