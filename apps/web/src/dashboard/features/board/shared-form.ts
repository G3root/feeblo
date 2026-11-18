import { DEFAULT_BOARD_ICON } from "@feeblo/web-shared/icons/defaults";
import { formOptions } from "@tanstack/react-form";
import { z } from "zod";

export const boardFormSchema = z.object({
  name: z.string().trim().min(1, "Board name is required"),
  icon: z.string().trim().max(64).nullable(),
  visibility: z.enum(["PUBLIC", "PRIVATE"]),
});

export const boardFormOpts = formOptions({
  defaultValues: {
    name: "",
    // SAFETY: The form's icon is nullable; null means "use the client default".
    icon: null as string | null,
    // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
    visibility: "PUBLIC" as "PUBLIC" | "PRIVATE",
  },
  validators: {
    onSubmit: boardFormSchema,
  },
});
