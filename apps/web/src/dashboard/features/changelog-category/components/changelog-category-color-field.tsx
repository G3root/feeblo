import { Field, FieldLabel } from "@feeblo/ui/field";
import { withForm } from "@feeblo/ui/hooks/form";
import { RadioGroupPrimitive, RadioPrimitive } from "@feeblo/ui/radio-group";
import { cn } from "@feeblo/ui/utils";
import { CheckIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  CHANGELOG_CATEGORY_COLORS,
  changelogCategoryFormOpts,
} from "../shared-form";

export const ChangelogCategoryColorField = withForm({
  ...changelogCategoryFormOpts,
  render: ({ form }) => {
    return (
      <form.AppField
        children={(field) => (
          <Field
            dirty={field.state.meta.isDirty}
            invalid={!field.state.meta.isValid}
            name={field.name}
            touched={field.state.meta.isTouched}
          >
            <FieldLabel>Color</FieldLabel>
            <RadioGroupPrimitive
              aria-label="Color"
              className="flex items-center gap-3"
              onValueChange={field.handleChange}
              value={field.state.value}
            >
              {CHANGELOG_CATEGORY_COLORS.map((swatch) => (
                <RadioPrimitive.Root
                  aria-label={`Pick color ${swatch}`}
                  className="hover:ring-ring hover:ring-offset-background focus-visible:ring-ring focus-visible:ring-offset-background data-checked:ring-ring data-checked:ring-offset-background relative flex size-8 cursor-pointer items-center justify-center rounded-full transition-transform hover:scale-110 hover:ring-2 hover:ring-offset-2 focus-visible:ring-2 focus-visible:ring-offset-2 data-checked:ring-2 data-checked:ring-offset-2 data-disabled:cursor-not-allowed data-disabled:opacity-64"
                  key={swatch}
                  style={{ backgroundColor: swatch }}
                  value={swatch}
                >
                  <RadioPrimitive.Indicator
                    className={cn(
                      "drop-shadow-sm data-unchecked:hidden",
                      isLightOklch(swatch) ? "text-black" : "text-white"
                    )}
                    keepMounted
                  >
                    <HugeiconsIcon icon={CheckIcon} size={14} />
                  </RadioPrimitive.Indicator>
                </RadioPrimitive.Root>
              ))}
            </RadioGroupPrimitive>
          </Field>
        )}
        name="color"
      />
    );
  },
});

/**
 * Picks the check-mark color from the OKLCh lightness channel (L in [0, 1]);
 * light swatches get a dark check, dark swatches get a light one.
 */
function isLightOklch(color: string) {
  const lightness = Number.parseFloat(
    color.match(/^oklch\(([\d.]+)/)?.[1] ?? "0"
  );
  return lightness > 0.7;
}
