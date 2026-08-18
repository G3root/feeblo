import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";

import { useEntitlements } from "~/hooks/use-entitlements";

import { boardFormOpts } from "../shared-form";

export const BoardVisibilityField = withForm({
  ...boardFormOpts,
  render: ({ form }) => {
    const { entitlements } = useEntitlements();
    const canUsePrivateBoards = entitlements.capabilities.privateBoards;

    return (
      <form.AppField
        children={(field) => (
          <Field name={field.name}>
            <FieldLabel>Visibility</FieldLabel>

            <Select
              onValueChange={(value) =>
                // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
                field.handleChange(value as "PUBLIC" | "PRIVATE")
              }
              value={field.state.value}
            >
              <SelectTrigger className="w-full">
                {/* TODO: MAP THE Selected LABEL */}
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="PUBLIC">Public</SelectItem>
                <SelectItem disabled={!canUsePrivateBoards} value="PRIVATE">
                  Private
                </SelectItem>
              </SelectPopup>
            </Select>
            {canUsePrivateBoards ? null : (
              <FieldDescription>
                Private boards require the Starter plan or higher.
              </FieldDescription>
            )}
          </Field>
        )}
        name="visibility"
      />
    );
  },
});
