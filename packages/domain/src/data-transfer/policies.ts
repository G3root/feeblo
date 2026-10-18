import * as Effect from "effect/Effect";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";

/**
 * The authorization gates for board CSV transfer.
 *
 * Both the service methods and the frontend's `hasPermission` checks resolve
 * the same named permissions (see `docs/permissions.md`), so a contributor
 * cannot stage an import, confirm one, or export a board by calling the
 * transport directly. They live here rather than inline so the two directions
 * cannot drift into different permission ids.
 *
 * Import is a write, so a plan-locked workspace refuses it; export is the
 * remedy, not a write, and stays open. The plan read touches the database, and
 * this policy is applied inside the import service rather than at an RPC
 * boundary, so its driver failures are remapped here instead of leaking a
 * `EffectDrizzleQueryError` past the service contract.
 */
export const canImportPosts = (organizationId: string) =>
  Policy.all(
    Policy.canPermission(organizationId, "boards.importPosts"),
    Effect.gen(function* () {
      const entitlementPolicy = yield* EntitlementPolicy;
      yield* entitlementPolicy.assertWorkspaceWritable(organizationId);
    }).pipe(withRemapDbErrors("DataImport", "select"))
  );

export const canExportData = (organizationId: string): Policy.Policy =>
  Policy.canPermission(organizationId, "boards.exportData");
