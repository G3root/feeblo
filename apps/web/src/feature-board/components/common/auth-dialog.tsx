import { useState } from "react";
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

export function AuthDialog({ variant }: AuthDialogProps) {
  const [open, setOpen] = useState(false);
  const isSignIn = variant === "sign-in";

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={(props) => (
          <Button variant="secondary" {...props}>
            {isSignIn ? "Sign in" : "Sign up"}
          </Button>
        )}
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isSignIn ? "Sign in" : "Create account"}</DialogTitle>
          <p className="text-muted-foreground text-sm">
            {isSignIn
              ? "Enter your credentials to continue."
              : "Start with a new account."}
          </p>
        </DialogHeader>
        <DialogPanel>
          {isSignIn ? (
            <SignInForm onSuccess={() => setOpen(false)} />
          ) : (
            <SignUpForm onSuccess={() => setOpen(false)} />
          )}
        </DialogPanel>
      </DialogContent>
    </Dialog>
  );
}

function SignInForm({ onSuccess }: { onSuccess: () => void }) {
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
        window.location.href = "/email-verify";
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

function SignUpForm({ onSuccess }: { onSuccess: () => void }) {
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

      onSuccess();
      window.location.href = "/email-verify";
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
