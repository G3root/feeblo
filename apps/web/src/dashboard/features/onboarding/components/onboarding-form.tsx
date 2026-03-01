import { z } from "zod";
import { Card, CardContent } from "~/components/ui/card";
import { toastManager } from "~/components/ui/toast";
import { useAppForm } from "~/hooks/form";
import { authClient } from "~/lib/auth-client";
import { OnboardingShell } from "./onboarding-shell";

const OnboardingFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required"),
});

interface OnboardingFormProps {
  defaultName: string;
  onCompleted: () => void;
}

export function OnboardingForm({
  defaultName,
  onCompleted,
}: OnboardingFormProps) {
  const form = useAppForm({
    defaultValues: {
      name: defaultName,
    },
    validators: {
      onChange: OnboardingFormSchema,
    },
    onSubmit: async ({ value }) => {
      const response = await authClient.updateUser({
        onboardedOn: new Date(),
        name: value.name.trim(),
      });

      if (response.error) {
        toastManager.add({
          title: response.error.message || "Failed to complete onboarding",
          type: "error",
        });
        return;
      }

      toastManager.add({
        title: "Welcome aboard",
        type: "success",
      });
      onCompleted();
    },
  });

  return (
    <OnboardingShell>
      <OnboardingShell.Heading
        description="Set your display name to finish account setup."
        title="Complete onboarding"
      />

      <Card>
        <CardContent className="pt-6">
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              form.handleSubmit();
            }}
          >
            <OnboardingShell.Body>
              <form.AppField
                children={(field) => (
                  <field.TextField
                    id="onboarding-name"
                    label="Display name"
                    placeholder="Your name"
                  />
                )}
                name="name"
              />
            </OnboardingShell.Body>

            <OnboardingShell.Actions>
              <form.AppForm>
                <form.SubscribeButton className="w-full" label="Continue" />
              </form.AppForm>
            </OnboardingShell.Actions>
          </form>
        </CardContent>
      </Card>
    </OnboardingShell>
  );
}
