import { Button } from "@feeblo/ui/button";
import { Field, FieldDescription, FieldError } from "@feeblo/ui/field";
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

import { m } from "../paraglide/messages.js";
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
  otp: z.string().length(6, { error: () => m.orange_candid_mole() }),
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

const signInFieldsProps: SignInFieldsProps = {};

export const SignInFields = withForm({
  ...signInFormOpts,
  props: signInFieldsProps,
  render: ({ form, submitLabel, children }) => (
    <>
      <form.AppField name="email">
        {(field) => (
          <field.TextField label={m.inclusive_quick_trout()} type="email" />
        )}
      </form.AppField>
      <form.AppField name="password">
        {(field) => <field.PasswordField label={m.least_away_snake()} />}
      </form.AppField>
      {children ? <div className="flex justify-end">{children}</div> : null}
      <form.AppForm>
        <form.SubscribeButton
          className="w-full"
          label={submitLabel ?? m.salty_few_seal()}
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

const signUpFieldsProps: SignUpFieldsProps = {};

export const SignUpFields = withForm({
  ...signUpFormOpts,
  props: signUpFieldsProps,
  render: ({ form, disabled, submitLabel, children }) => (
    <>
      <form.AppField name="name">
        {(field) => <field.TextField label={m.topical_nimble_cockroach()} />}
      </form.AppField>
      <form.AppField name="email">
        {(field) => (
          <field.TextField label={m.inclusive_quick_trout()} type="email" />
        )}
      </form.AppField>
      <form.AppField name="password">
        {(field) => <field.PasswordField label={m.least_away_snake()} />}
      </form.AppField>
      <form.AppField name="confirmPassword">
        {(field) => <field.PasswordField label={m.lime_nice_swallow()} />}
      </form.AppField>
      {children}
      <form.AppForm>
        <form.SubscribeButton
          className="w-full"
          disabled={disabled}
          label={submitLabel ?? m.mealy_patchy_shrimp()}
          type="submit"
        />
      </form.AppForm>
    </>
  ),
});

interface OtpFormFieldsProps {
  submitLabel?: string;
}

const otpFormFieldsProps: OtpFormFieldsProps = {};

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
              <OTPField
                className="justify-center gap-4"
                id={field.name}
                length={6}
                name={field.name}
                onBlur={field.handleBlur}
                onValueChange={(value) => field.handleChange(value)}
                size="lg"
                value={field.state.value}
              >
                <OTPFieldInput aria-label={m.plain_muddy_snake({ index: 1 })} />
                <OTPFieldInput aria-label={m.plain_muddy_snake({ index: 2 })} />
                <OTPFieldInput aria-label={m.plain_muddy_snake({ index: 3 })} />
                <OTPFieldSeparator />
                <OTPFieldInput aria-label={m.plain_muddy_snake({ index: 4 })} />
                <OTPFieldInput aria-label={m.plain_muddy_snake({ index: 5 })} />
                <OTPFieldInput aria-label={m.plain_muddy_snake({ index: 6 })} />
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
          label={submitLabel ?? m.kind_less_vole()}
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
      {m.knotty_lucky_tadpole()}
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
          ? m.curly_caring_rat({ seconds: cooldown })
          : m.many_maroon_jay()}
      </span>
    </FieldDescription>
  );
}
