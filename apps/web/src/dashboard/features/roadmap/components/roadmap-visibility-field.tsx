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

import { roadmapFormOpts } from "../shared-form";

export const RoadmapVisibilityField = withForm({
  ...roadmapFormOpts,
  render: ({ form }) => {
    const { entitlements, isLoading } = useEntitlements();
    const canUsePrivateRoadmaps =
      isLoading || entitlements.capabilities.privateRoadmaps;

    return (
      <form.AppField
        children={(field) => (
          <Field name={field.name}>
            <FieldLabel>Visibility</FieldLabel>

            <Select
              onValueChange={(value) =>
                field.handleChange(value as "public" | "private")
              }
              value={field.state.value}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value: string) =>
                    value === "private" ? "Private" : "Public"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="public">Public</SelectItem>
                <SelectItem disabled={!canUsePrivateRoadmaps} value="private">
                  Private
                </SelectItem>
              </SelectPopup>
            </Select>
            {canUsePrivateRoadmaps ? null : (
              <FieldDescription>
                Private roadmaps require the Starter plan or higher.
              </FieldDescription>
            )}
          </Field>
        )}
        name="visibility"
      />
    );
  },
});
