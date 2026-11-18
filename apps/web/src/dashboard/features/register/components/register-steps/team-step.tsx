import { Button } from "@feeblo/ui/button";
import { withForm } from "@feeblo/ui/hooks/form";
import { Input } from "@feeblo/ui/input";
import { Cancel01Icon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useStore } from "@tanstack/react-store";

import { registerFormOpts } from "../../shared-form";

/**
 * Step four: who else is coming.
 *
 * Optional, and the last step, so a reader in a hurry can press create without
 * filling it in. The invitations are sent after the workspace exists, which is
 * why they cannot fail this form: a refused invitation is reported once the
 * workspace is already there.
 *
 * Blank rows are dropped on submit rather than rejected here, so adding a row
 * and changing your mind costs nothing.
 */
export const TeamStep = withForm({
  ...registerFormOpts,
  render: function TeamStepRender({ form }) {
    const invites = useStore(form.store, (state) => state.values.invites);

    const update = (index: number, value: string) => {
      form.setFieldValue(
        "invites",
        invites.map((invite, position) => (position === index ? value : invite))
      );
    };

    const remove = (index: number) => {
      form.setFieldValue(
        "invites",
        invites.filter((_, position) => position !== index)
      );
    };

    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted-foreground text-sm">
          They get an email invitation with the least access this product
          offers. You can change someone&apos;s role later, and you can skip
          this and invite people from settings.
        </p>

        <div className="flex flex-col gap-2">
          {invites.map((invite, index) => (
            <div
              className="flex items-center gap-2"
              // The list has no ids: two blank rows are the same value, and an
              // email is unique enough to key on until it is edited.
              key={`invite-${index}`}
            >
              <Input
                aria-label={`Invitation ${index + 1}`}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(event) => update(index, event.target.value)}
                placeholder="teammate@example.com"
                spellCheck={false}
                type="email"
                value={invite}
              />
              <Button
                aria-label={`Remove invitation ${index + 1}`}
                onClick={() => remove(index)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <HugeiconsIcon icon={Cancel01Icon} />
              </Button>
            </div>
          ))}
        </div>

        <Button
          className="self-start"
          onClick={() => form.setFieldValue("invites", [...invites, ""])}
          size="sm"
          type="button"
          variant="outline"
        >
          <HugeiconsIcon icon={Plus} />
          Add a teammate
        </Button>
      </div>
    );
  },
});
