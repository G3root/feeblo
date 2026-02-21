import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import {
  EmailSchema,
  NameSchema,
  PasswordAndConfirmPasswordSchema,
} from "~/utils/user-validation";

export const Route = createFileRoute("/sign-up")({
  component: RouteComponent,
});

const FormSchema = z
  .object({
    name: NameSchema,
    email: EmailSchema,
  })
  .and(PasswordAndConfirmPasswordSchema);

function RouteComponent() {
  const form = useAppForm({
    defaultValues: {
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
    validators: {
      onChange: FormSchema,
    },
    onSubmit: async ({ value }) => {
      await authClient.signUp.email({
        email: value.email,
        name: value.name,
        password: value.password,
        callbackURL: "/",
      });
    },
  });
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <form
          className="flex flex-col gap-6"
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
            children={(field) => <field.TextField label="Email" />}
            name="email"
          />

          <form.AppField
            children={(field) => <field.TextField label="Password" />}
            name="password"
          />

          <form.AppField
            children={(field) => <field.TextField label="Confirm Password" />}
            name="confirmPassword"
          />

          <form.AppForm>
            <form.SubscribeButton label="Signup" />
          </form.AppForm>
        </form>
      </div>
    </div>
  );
}
