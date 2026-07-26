import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";

const makeNotificationPolicy = Effect.succeed({
  canAccess: (organizationId: string) => Policy.hasMembership(organizationId),
});

export class NotificationPolicy extends Context.Service<NotificationPolicy>()(
  "NotificationPolicy",
  { make: makeNotificationPolicy }
) {
  static readonly layer = Layer.effect(this, this.make);
}
