import * as Context from "effect/Context";

import { isFeatureEnabled } from "../feature-flags";

/**
 * Whether the audit log is switched on for this process.
 *
 * A `Context.Reference` rather than a direct `isFeatureEnabled` read, so a test
 * can exercise the writing path while the product default stays off: the
 * recorder asks this at call time, and `AUDIT_LOG` in `feature-flags.ts` is
 * only the default it falls back to.
 *
 * Off means the recorder writes nothing at all. The table, the migration and
 * the read surface ship ahead of the switch; turning it on starts the history
 * at that moment, which is why the default is the product decision and not a
 * per-request one.
 */
export class AuditLogEnabled extends Context.Reference<boolean>(
  "@feeblo/domain/audit-log/AuditLogEnabled",
  { defaultValue: () => isFeatureEnabled("AUDIT_LOG") }
) {}
