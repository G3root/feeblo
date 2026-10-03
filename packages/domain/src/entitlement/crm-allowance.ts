import { currentDb, schema } from "@feeblo/db";
import { count, eq } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { WorkspaceRepository } from "../workspace/repository";
import { EntitlementPolicy } from "./policies";

const makeCrmEntryGate = Effect.gen(function* () {
  const entitlementPolicy = yield* EntitlementPolicy;

  /**
   * Runs the plan's CRM-entry check — contacts and companies together are
   * the workspace's CRM entries, the same count the contact and company
   * policies have always checked — but only after taking the workspace
   * row's `no key update` lock. The lock is what makes the check exact
   * under concurrency: two creates racing near the cap serialize on the
   * workspace, so the loser re-counts with the winner's row visible and is
   * denied instead of both seeing room and inserting.
   *
   * Must run inside the caller's transaction (the database connection is
   * fiber-local, so the lock joins it); every call site does. `no key
   * update` rather than `update` because every table in the workspace
   * points at this row, and the stronger lock would block unrelated inserts
   * that merely reference the workspace — the same reasoning the Public
   * API's company create applies to its own locked check, which predates
   * this gate and remains that surface's enforcement point.
   */
  const ensureCapacity = (organizationId: string) =>
    Effect.gen(function* () {
      const db = yield* currentDb;

      yield* db
        .select({ id: schema.organizationTable.id })
        .from(schema.organizationTable)
        .where(eq(schema.organizationTable.id, organizationId))
        .for("no key update");

      return yield* entitlementPolicy.canCreateCrmEntry({
        organizationId,
        crmEntryCount: Effect.gen(function* () {
          const [contactRows, companyRows] = yield* Effect.all([
            db
              .select({ total: count() })
              .from(schema.contactTable)
              .where(eq(schema.contactTable.organizationId, organizationId)),
            db
              .select({ total: count() })
              .from(schema.companyTable)
              .where(eq(schema.companyTable.organizationId, organizationId)),
          ]);
          return (
            Number(contactRows[0]?.total ?? 0) +
            Number(companyRows[0]?.total ?? 0)
          );
        }),
      });
    });

  return { ensureCapacity } as const;
});

/**
 * The plan's CRM-entry limit, enforced exactly under concurrency.
 *
 * Consumers: the identity resolver (a resolution that creates a contact on
 * behalf of a customer), the dashboard contact create, and the dashboard
 * company create. Each runs the gate as the first statement of its own
 * transaction, so every contact- or company-creating write in the product
 * serializes on the same workspace row.
 */
export class CrmEntryGate extends Context.Service<CrmEntryGate>()(
  "CrmEntryGate",
  { make: makeCrmEntryGate }
) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(
      EntitlementPolicy.layer.pipe(Layer.provide(WorkspaceRepository.layer))
    )
  );
}
