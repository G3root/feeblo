import type { BetterAuthPluginDBSchema } from "@better-auth/core/db";

export const schema = {
  user: {
    fields: {
      restrictedToOrganizationId: {
        type: "string",
        required: false,
        input: false,
        defaultValue: null,
      },
    },
  },
} satisfies BetterAuthPluginDBSchema;
