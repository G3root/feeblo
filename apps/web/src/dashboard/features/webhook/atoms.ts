import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Atom from "effect/reactivity/Atom";
import * as Stream from "effect/Stream";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

export const webhookReactivityKeys = (organizationId: string) => ({
  webhooks: [organizationId],
});

/** The endpoint list of one organization, cached per organization id. */
export const endpointsAtom = Atom.family((organizationId: string) =>
  DashboardClient.query(
    "ListWebhookEndpoints",
    { organizationId },
    { reactivityKeys: webhookReactivityKeys(organizationId) }
  ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type Endpoint = Atom.Success<ReturnType<typeof endpointsAtom>>[number];

export type DeliveryHistoryArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

export type DeliveryPage = Effect.Success<
  ReturnType<typeof loadWebhookDeliveryHistory>
>;
export type Delivery = DeliveryPage["items"][number];

const loadWebhookDeliveryHistory = (input: {
  readonly connectionId: string;
  readonly organizationId: string;
  readonly cursor?: string;
}) =>
  Effect.gen(function* () {
    const client = yield* DashboardClient;
    return yield* client("GetWebhookDeliveryHistory", input);
  });

export const deliveryHistoryRefreshAtom = Atom.family(
  (args: DeliveryHistoryArgs) =>
    Atom.writable<number, void>(
      () => 0,
      (ctx) => {
        ctx.setSelf(ctx.get(deliveryHistoryRefreshAtom(args)) + 1);
      }
    )
);

export const deliveriesAtom = Atom.family((args: DeliveryHistoryArgs) =>
  DashboardClient.runtime
    .pull((get) => {
      get(deliveryHistoryRefreshAtom(args));
      // SAFETY: The first delivery-history request has no cursor.
      return Stream.paginate(undefined as string | undefined, (cursor) =>
        loadWebhookDeliveryHistory({
          connectionId: args.connectionId,
          ...(cursor === undefined ? undefined : { cursor }),
          organizationId: args.organizationId,
        }).pipe(
          Effect.map(
            (page) => [[page], Option.fromNullishOr(page.nextCursor)] as const
          )
        )
      );
    })
    .pipe(Atom.setIdleTTL("5 minutes"))
);

export const deliveriesLoadingAtom = Atom.family((args: DeliveryHistoryArgs) =>
  Atom.map(deliveriesAtom(args), (_) => _.waiting)
);

export const preloadDeliveryHistoryAtom = Atom.fnSync(
  (args: DeliveryHistoryArgs, get) => {
    get(deliveriesAtom(args));
  }
);

export const createWebhookEndpointAtom = DashboardClient.mutation(
  "CreateWebhookEndpoint"
);
export const updateWebhookEndpointAtom = DashboardClient.mutation(
  "UpdateWebhookEndpoint"
);
export const testWebhookDeliveryAtom = DashboardClient.mutation(
  "TestWebhookDelivery"
);
export const rotateWebhookSecretAtom = DashboardClient.mutation(
  "RotateWebhookSecret"
);
export const resumeWebhookEndpointAtom = DashboardClient.mutation(
  "ResumeWebhookEndpoint"
);
export const pauseWebhookEndpointAtom = DashboardClient.mutation(
  "PauseWebhookEndpoint"
);
export const removeWebhookEndpointAtom = DashboardClient.mutation(
  "RemoveWebhookEndpoint"
);
export const retryWebhookDeliveryAtom = DashboardClient.mutation(
  "RetryWebhookDelivery"
);
