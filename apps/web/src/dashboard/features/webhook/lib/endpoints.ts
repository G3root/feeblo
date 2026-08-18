import { fetchRpc } from "~/lib/runtime";

export const loadEndpoints = (organizationId: string) =>
  fetchRpc((rpc) => rpc.WebhookEndpointList({ organizationId })).then(
    (result) => [...result]
  );

export const loadDeliveries = (
  organizationId: string,
  connectionId: string,
  cursor?: string
) =>
  fetchRpc((rpc) =>
    rpc.WebhookDeliveryHistory({
      connectionId,
      ...(cursor === undefined ? undefined : { cursor }),
      organizationId,
    })
  );
