import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { NotificationPreferenceRepository } from "./repository";
import { NotificationPreferenceRpcs } from "./rpcs";
import {
  emailPreferenceChannel,
  resolveNotificationPreferenceState,
  type TNotificationPreferenceSetRequest,
  type TNotificationPreferenceQuery,
} from "./schema";

export const NotificationPreferenceRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* NotificationPreferenceRepository;

  /** Reads the stored rows and applies the on-by-default resolution. */
  const readState = (organizationId: string, userId: string) =>
    repository
      .listForRecipient({ organizationId, userId })
      .pipe(Effect.map(resolveNotificationPreferenceState));

  const get = ({ organizationId }: TNotificationPreferenceQuery) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      return yield* readState(organizationId, session.session.userId);
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(organizationId)),
      withRemapDbErrors("NotificationPreference", "select")
    );

  const set = ({
    enabled,
    organizationId,
    target,
  }: TNotificationPreferenceSetRequest) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      yield* repository.setPreference({
        category: target,
        channel: emailPreferenceChannel,
        enabled,
        organizationId,
        userId: session.session.userId,
      });
      // Answer with the state the write committed, so a caller renders the
      // server's resolution instead of a second read of it.
      return yield* readState(organizationId, session.session.userId);
    }).pipe(
      Policy.withPolicy(Policy.hasMembership(organizationId)),
      withRemapDbErrors("NotificationPreference", "upsert")
    );

  return {
    NotificationPreferenceGet: get,
    NotificationPreferenceSet: set,
  };
});

export const NotificationPreferenceRpcHandlers =
  NotificationPreferenceRpcs.toLayer(
    NotificationPreferenceRpcHandlersEffect
  ).pipe(Layer.provide(NotificationPreferenceRepository.layer));
