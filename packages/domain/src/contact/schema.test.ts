import { describe, expect, it } from "@effect/vitest";
import { ContactAttributeDefinitionId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { ContactCreate } from "./schema";

describe("ContactCreate", () => {
  it.effect("rejects duplicate attribute IDs", () =>
    Effect.gen(function* () {
      const organizationId = yield* WorkspaceId.generate;
      const attributeId = yield* ContactAttributeDefinitionId.generate;
      const error = yield* Effect.flip(
        Schema.decodeUnknownEffect(ContactCreate)({
          organizationId,
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
