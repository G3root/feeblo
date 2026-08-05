import { describe, expect, it } from "@effect/vitest";
import { CompanyAttributeDefinitionId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { CompanyCreate } from "./schema";

describe("CompanyCreate", () => {
  it.effect("rejects duplicate attribute IDs", () =>
    Effect.gen(function* () {
      const organizationId = yield* WorkspaceId.generate;
      const attributeId = yield* CompanyAttributeDefinitionId.generate;
      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(CompanyCreate)({
          organizationId,
          name: "Acme",
          attributeValues: [
            { attributeId, value: "first" },
            { attributeId, value: "second" },
          ],
        })
      );

      expect(error.message).toContain("duplicate attributeId");
    })
  );
});
