import { describe, expect, it } from "@effect/vitest";
import {
  AUDIT_ACCESS_ACTIONS,
  AUDIT_ACTIONS,
  AuditActionSchema,
  auditActionLabel,
  auditResourceLabel,
  auditResourceTypeOf,
  isAuditAccessAction,
} from "@feeblo/domain-contracts/audit";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

describe("audit catalog", () => {
  it("derives every action's resource from the action itself", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(auditResourceTypeOf(action)).toBe(action.split(".")[0]);
      expect(auditResourceLabel(auditResourceTypeOf(action))).not.toBeNull();
    }
  });

  it("labels every declared action", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(auditActionLabel(action)).not.toBeNull();
    }

    expect(auditActionLabel("post.vanished")).toBeNull();
  });

  it("declares every access action in the catalog", () => {
    for (const action of AUDIT_ACCESS_ACTIONS) {
      expect(AUDIT_ACTIONS).toContain(action);
      expect(isAuditAccessAction(action)).toBe(true);
    }

    expect(new Set(AUDIT_ACCESS_ACTIONS).size).toBe(
      AUDIT_ACCESS_ACTIONS.length
    );
    expect(isAuditAccessAction("post.updated")).toBe(false);
  });

  it.effect("rejects an action this build does not declare", () =>
    Effect.gen(function* () {
      const decoded =
        yield* Schema.decodeEffect(AuditActionSchema)("post.updated");

      expect(decoded).toBe("post.updated");

      // The input is deliberately not a declared action; that is the case
      // under test, so the typed decoder cannot express it.
      // oxlint-disable-next-line effecttsgo/prefer-typed-schema-decoder -- see above.
      const decodeUnknown = Schema.decodeUnknownEffect(AuditActionSchema);
      const rejected = yield* Effect.flip(decodeUnknown("post.vanished"));
      expect(rejected._tag).toBe("SchemaError");
    })
  );
});
