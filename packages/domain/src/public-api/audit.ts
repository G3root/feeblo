import type { PublicApiScope } from "@feeblo/domain-contracts/public-api-scope";
import * as Effect from "effect/Effect";

import type { TAuditActorRef } from "../audit-log/recorder";
import { AuditLogRecorder } from "../audit-log/recorder";
import type { PublicApiCall } from "./api-key-auth";

/**
 * The credential behind a Public API request, as an audited actor.
 *
 * Built here rather than in `audit-log/attribution.ts` on purpose: that module
 * reads the session middleware to name a dashboard user, and the Public API
 * must never reach it — a machine credential does not become a session
 * (`docs/adr/0004`, and the boundary override in `oxlint.config.ts`). An OAuth
 * grant is different: it *is* a member's authority, delegated, so the subject
 * travels with it as the user behind the client.
 */
const actorOf = (call: PublicApiCall): TAuditActorRef =>
  call.credential._tag === "ApiKey"
    ? {
        type: "api_key",
        tokenId: call.credential.keyId,
        ...(call.label === undefined ? undefined : { label: call.label }),
      }
    : {
        type: "oauth_client",
        tokenId: call.credential.clientId,
        userId: call.credential.subject,
        ...(call.label === undefined ? undefined : { label: call.label }),
      };

/**
 * Record a request refused for a scope the key does not hold.
 *
 * Best effort, deliberately: the request is already being refused, so there is
 * no transaction to abort and no outcome to change. A missing audit row here is
 * a gap to alert on, never a second error for the caller — the caller is
 * getting a 403 either way.
 *
 * No coalescing. A client looping mis-scoped requests is bounded by the
 * per-key rate limit the middleware charges before the scope gate runs, which
 * is a stricter bound than a time window would give.
 */
export const recordScopeDenial = (call: PublicApiCall, scope: PublicApiScope) =>
  Effect.gen(function* () {
    const recorder = yield* AuditLogRecorder;
    yield* recorder.recordBestEffort({
      organizationId: call.organizationId,
      actor: actorOf(call),
      source: "public_api",
      action: "api.request",
      outcome: "denied",
      denialReason: `Missing ${scope} scope`,
      metadata: { scope },
    });
  });
