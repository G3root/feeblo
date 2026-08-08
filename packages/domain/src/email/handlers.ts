import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { EmailEventRepository } from "./repository";
import { EmailAdminRpcs } from "./rpcs";
import type {
  TEmailDeadLetterList,
  TEmailDeliveryStats,
  TEmailSuppressedDelete,
  TEmailSuppressedList,
} from "./schema";

/**
 * Admin RPCs for email delivery observability. Suppressed-email management is
 * restricted to workspace managers (owners/admins) because it exposes
 * recipient addresses.
 */
const canManageEmails = (organizationId: string) =>
  Policy.canPermission(organizationId, "workspace.update");

export const EmailAdminRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* EmailEventRepository;

  return {
    EmailSuppressedList: ({ organizationId }: TEmailSuppressedList) =>
      repository
        .listSuppressed()
        .pipe(
          Policy.withPolicy(canManageEmails(organizationId)),
          withRemapDbErrors("SuppressedEmail", "select")
        ),

    EmailSuppressedDelete: ({
      email,
      organizationId,
    }: TEmailSuppressedDelete) =>
      repository.deleteSuppressed(email).pipe(
        Effect.map((deleted) => ({ deleted })),
        Policy.withPolicy(canManageEmails(organizationId)),
        withRemapDbErrors("SuppressedEmail", "delete")
      ),

    EmailDeadLetterList: ({ organizationId }: TEmailDeadLetterList) =>
      repository
        .listDeadLetters(organizationId)
        .pipe(
          Policy.withPolicy(canManageEmails(organizationId)),
          withRemapDbErrors("EmailEvent", "select")
        ),

    EmailDeliveryStats: ({ organizationId }: TEmailDeliveryStats) =>
      repository
        .deliveryStats(organizationId)
        .pipe(
          Policy.withPolicy(canManageEmails(organizationId)),
          withRemapDbErrors("EmailDelivery", "select")
        ),
  };
});

export const EmailAdminRpcHandlers = EmailAdminRpcs.toLayer(
  EmailAdminRpcHandlersEffect
).pipe(Layer.provide(EmailEventRepository.layer));
