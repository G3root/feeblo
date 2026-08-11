import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { Checkbox } from "@feeblo/ui/checkbox";
import { Input } from "@feeblo/ui/input";
import { Label } from "@feeblo/ui/label";
import { toastManager } from "@feeblo/ui/toast";
import { getAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

const selectableEventTypes = [
  "feedback.post.created",
  "feedback.post.status_changed",
] as const;

type SelectableEventType = (typeof selectableEventTypes)[number];
type Endpoint = Awaited<ReturnType<typeof loadEndpoints>>[number];
type DeliveryPage = Awaited<ReturnType<typeof loadDeliveries>>;

export const Route = createFileRoute("/$organizationId/settings/webhooks")({
  component: WebhooksSettingsRoute,
  beforeLoad: async ({ params }) => {
    const session = await getAuthSession();
    if (
      session !== null &&
      hasPermission(params.organizationId, "webhooks.manage")(session)
    ) {
      await loadEndpoints(params.organizationId);
    }
    return null;
  },
});

function WebhooksSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "webhooks.manage")
  );
  if (isPending) {
    return null;
  }
  return allowed ? (
    <WebhooksSettings organizationId={organizationId} />
  ) : (
    <SettingsAccessDenied />
  );
}

function WebhooksSettings({ organizationId }: { organizationId: string }) {
  const [endpoints, setEndpoints] = useState<readonly Endpoint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [createEvents, setCreateEvents] =
    useState<readonly SelectableEventType[]>(selectableEventTypes);
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    readonly endpointName: string;
    readonly value: string;
  } | null>(null);
  const [editing, setEditing] = useState<{
    readonly id: Endpoint["id"];
    readonly name: string;
    readonly endpointUrl: string;
  } | null>(null);
  const [removeEndpoint, setRemoveEndpoint] = useState<Endpoint | null>(null);
  const [historyConnectionId, setHistoryConnectionId] = useState<
    Endpoint["id"] | null
  >(null);
  const [deliveries, setDeliveries] = useState<DeliveryPage["items"]>([]);
  const [deliveryCursor, setDeliveryCursor] = useState<string | null>(null);
  const [isHistoryLoading, setIsHistoryLoading] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEndpoints(await loadEndpoints(organizationId));
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setIsLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const createEndpoint = async () => {
    try {
      const result = await fetchRpc((rpc) =>
        rpc.WebhookEndpointCreate({
          endpointUrl,
          eventTypes: [...createEvents],
          name,
          organizationId,
        })
      );
      setOneTimeSecret({
        endpointName: result.endpoint.name,
        value: result.signingSecret,
      });
      setName("");
      setEndpointUrl("");
      setCreateEvents(selectableEventTypes);
      await refresh();
      toastManager.add({ title: "Webhook endpoint created", type: "success" });
    } catch {
      toastManager.add({
        title: "Could not create webhook endpoint",
        type: "error",
      });
    }
  };

  const updateEvents = async (
    endpoint: Endpoint,
    nextEventTypes: readonly SelectableEventType[]
  ) => {
    try {
      await fetchRpc((rpc) =>
        rpc.WebhookEndpointUpdate({
          connectionId: endpoint.id,
          eventTypes: [...nextEventTypes],
          organizationId,
        })
      );
      await refresh();
    } catch {
      toastManager.add({
        title: "Could not update event selection",
        type: "error",
      });
    }
  };

  const saveEndpoint = async () => {
    if (editing === null) {
      return;
    }
    try {
      await fetchRpc((rpc) =>
        rpc.WebhookEndpointUpdate({
          connectionId: editing.id,
          ...(editing.endpointUrl.trim() === ""
            ? {}
            : { endpointUrl: editing.endpointUrl.trim() }),
          name: editing.name.trim(),
          organizationId,
        })
      );
      setEditing(null);
      await refresh();
      toastManager.add({ title: "Webhook endpoint updated", type: "success" });
    } catch {
      toastManager.add({
        title: "Could not update webhook endpoint",
        type: "error",
      });
    }
  };

  const showHistory = async (connectionId: Endpoint["id"], cursor?: string) => {
    setHistoryConnectionId(connectionId);
    setIsHistoryLoading(true);
    try {
      const page = await loadDeliveries(organizationId, connectionId, cursor);
      setDeliveries((current) =>
        cursor === undefined ? page.items : [...current, ...page.items]
      );
      setDeliveryCursor(page.nextCursor);
    } catch {
      toastManager.add({
        title: "Could not load delivery history",
        type: "error",
      });
    } finally {
      setIsHistoryLoading(false);
    }
  };

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Webhooks</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Deliver signed feedback events to your HTTPS endpoint.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        {oneTimeSecret === null ? null : (
          <section
            aria-label="Webhook signing secret"
            className="rounded-xl border border-warning/30 bg-warning/5 p-4"
          >
            <h2 className="font-medium">Copy the signing secret now</h2>
            <p className="mt-1 text-muted-foreground text-sm">
              This secret for {oneTimeSecret.endpointName} will not be shown
              again.
            </p>
            <code className="mt-3 block break-all rounded-md border bg-background p-3 text-sm">
              {oneTimeSecret.value}
            </code>
            <div className="mt-3 flex gap-2">
              <Button
                onClick={() =>
                  navigator.clipboard.writeText(oneTimeSecret.value).then(
                    () =>
                      toastManager.add({
                        title: "Signing secret copied",
                        type: "success",
                      }),
                    () =>
                      toastManager.add({
                        title: "Could not copy signing secret",
                        type: "error",
                      })
                  )
                }
                size="sm"
              >
                Copy secret
              </Button>
              <Button
                onClick={() => setOneTimeSecret(null)}
                size="sm"
                variant="outline"
              >
                Done
              </Button>
            </div>
          </section>
        )}

        <section className="grid gap-4 rounded-xl border p-4">
          <div>
            <h2 className="font-medium">New endpoint</h2>
            <p className="text-muted-foreground text-sm">
              Feeblo validates the address before saving and signs every
              request.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-name">Name</Label>
              <Input
                id="webhook-name"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="webhook-url">Endpoint URL</Label>
              <Input
                id="webhook-url"
                onChange={(event) => setEndpointUrl(event.target.value)}
                type="url"
                value={endpointUrl}
              />
            </div>
          </div>
          <EventSelection
            eventTypes={createEvents}
            idPrefix="create-webhook"
            onChange={setCreateEvents}
          />
          <Button
            className="w-fit"
            disabled={
              name.trim() === "" ||
              endpointUrl.trim() === "" ||
              createEvents.length === 0
            }
            onClick={createEndpoint}
          >
            Create endpoint
          </Button>
        </section>

        <section aria-label="Webhook endpoints" className="grid gap-3">
          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading endpoints…</p>
          ) : null}
          {loadFailed ? (
            <div className="rounded-xl border p-4 text-sm">
              Endpoints could not be loaded.{" "}
              <Button onClick={refresh} size="sm" variant="outline">
                Try again
              </Button>
            </div>
          ) : null}
          {!(isLoading || loadFailed) && endpoints.length === 0 ? (
            <p className="rounded-xl border p-6 text-center text-muted-foreground text-sm">
              No webhook endpoints yet.
            </p>
          ) : null}
          {endpoints.map((endpoint) => (
            <article className="rounded-xl border p-4" key={endpoint.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{endpoint.name}</h2>
                    <Badge>{endpoint.lifecycle}</Badge>
                    <Badge
                      variant={
                        endpoint.health === "failing"
                          ? "destructive"
                          : "outline"
                      }
                    >
                      {endpoint.health}
                    </Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground text-sm">
                    {endpoint.hostname}
                  </p>
                  <p className="mt-1 text-muted-foreground text-xs">
                    Last success: {formatOptionalDate(endpoint.lastSucceededAt)}{" "}
                    · Last failure: {formatOptionalDate(endpoint.lastFailedAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={async () => {
                      try {
                        const result = await fetchRpc((rpc) =>
                          rpc.WebhookTestDelivery({
                            connectionId: endpoint.id,
                            organizationId,
                          })
                        );
                        setTestResult(`${result.result}: ${result.deliveryId}`);
                        toastManager.add({
                          title: "Test delivery queued",
                          type: "success",
                        });
                      } catch {
                        toastManager.add({
                          title: "Could not queue test delivery",
                          type: "error",
                        });
                      }
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Test
                  </Button>
                  <Button
                    onClick={() => showHistory(endpoint.id)}
                    size="sm"
                    variant="outline"
                  >
                    History
                  </Button>
                  <Button
                    onClick={() =>
                      setEditing({
                        endpointUrl: "",
                        id: endpoint.id,
                        name: endpoint.name,
                      })
                    }
                    size="sm"
                    variant="outline"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        const result = await fetchRpc((rpc) =>
                          rpc.WebhookSecretRotate({
                            connectionId: endpoint.id,
                            organizationId,
                          })
                        );
                        setOneTimeSecret({
                          endpointName: endpoint.name,
                          value: result.signingSecret,
                        });
                      } catch {
                        toastManager.add({
                          title: "Could not rotate signing secret",
                          type: "error",
                        });
                      }
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Rotate secret
                  </Button>
                  <Button
                    onClick={async () => {
                      try {
                        await fetchRpc((rpc) =>
                          endpoint.lifecycle === "paused"
                            ? rpc.WebhookEndpointResume({
                                connectionId: endpoint.id,
                                organizationId,
                              })
                            : rpc.WebhookEndpointPause({
                                connectionId: endpoint.id,
                                organizationId,
                              })
                        );
                        await refresh();
                      } catch {
                        toastManager.add({
                          title: "Could not change endpoint lifecycle",
                          type: "error",
                        });
                      }
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {endpoint.lifecycle === "paused" ? "Resume" : "Pause"}
                  </Button>
                  <Button
                    onClick={() => setRemoveEndpoint(endpoint)}
                    size="sm"
                    variant="destructive"
                  >
                    Remove
                  </Button>
                </div>
              </div>
              <div className="mt-4">
                <EventSelection
                  eventTypes={endpoint.eventTypes}
                  idPrefix={endpoint.id}
                  onChange={(next) => updateEvents(endpoint, next)}
                />
              </div>
              {editing?.id === endpoint.id ? (
                <div className="mt-4 grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor={`edit-name-${endpoint.id}`}>Name</Label>
                    <Input
                      id={`edit-name-${endpoint.id}`}
                      onChange={(event) =>
                        setEditing({ ...editing, name: event.target.value })
                      }
                      value={editing.name}
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor={`edit-url-${endpoint.id}`}>
                      New URL (optional)
                    </Label>
                    <Input
                      id={`edit-url-${endpoint.id}`}
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          endpointUrl: event.target.value,
                        })
                      }
                      placeholder="Leave blank to keep the current URL"
                      type="url"
                      value={editing.endpointUrl}
                    />
                  </div>
                  <div className="flex gap-2 sm:col-span-2">
                    <Button
                      disabled={editing.name.trim() === ""}
                      onClick={saveEndpoint}
                      size="sm"
                    >
                      Save
                    </Button>
                    <Button
                      onClick={() => setEditing(null)}
                      size="sm"
                      variant="outline"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </section>

        {testResult === null ? null : (
          <p aria-live="polite" className="text-muted-foreground text-sm">
            Latest test delivery: {testResult}
          </p>
        )}
        {historyConnectionId === null ? null : (
          <DeliveryHistory
            connectionId={historyConnectionId}
            cursor={deliveryCursor}
            deliveries={deliveries}
            isLoading={isHistoryLoading}
            onLoadMore={(cursor) => showHistory(historyConnectionId, cursor)}
            onRetry={async (deliveryId) => {
              try {
                await fetchRpc((rpc) =>
                  rpc.WebhookDeliveryRetry({ deliveryId, organizationId })
                );
                toastManager.add({
                  title: "Delivery retry queued",
                  type: "success",
                });
                await showHistory(historyConnectionId);
              } catch {
                toastManager.add({
                  title: "Could not retry delivery",
                  type: "error",
                });
              }
            }}
          />
        )}
      </SettingsLayout.Content>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setRemoveEndpoint(null);
          }
        }}
        open={removeEndpoint !== null}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove webhook endpoint?</AlertDialogTitle>
            <AlertDialogDescription>
              Its encrypted URL and signing keys are erased immediately. Pending
              deliveries are canceled while safe history is retained
              temporarily.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (removeEndpoint === null) {
                  return;
                }
                try {
                  await fetchRpc((rpc) =>
                    rpc.WebhookEndpointRemove({
                      connectionId: removeEndpoint.id,
                      organizationId,
                    })
                  );
                  if (historyConnectionId === removeEndpoint.id) {
                    setHistoryConnectionId(null);
                  }
                  setRemoveEndpoint(null);
                  await refresh();
                  toastManager.add({
                    title: "Webhook endpoint removed",
                    type: "success",
                  });
                } catch {
                  toastManager.add({
                    title: "Could not remove webhook endpoint",
                    type: "error",
                  });
                }
              }}
            >
              Remove endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </SettingsLayout.Root>
  );
}

function EventSelection({
  eventTypes,
  idPrefix,
  onChange,
}: {
  readonly eventTypes: readonly SelectableEventType[];
  readonly idPrefix: string;
  readonly onChange: (eventTypes: readonly SelectableEventType[]) => void;
}) {
  return (
    <fieldset className="flex flex-wrap gap-4">
      <legend className="mb-2 font-medium text-sm">Events</legend>
      {selectableEventTypes.map((eventType) => {
        const id = `${idPrefix}-${eventType}`;
        return (
          <div className="flex items-center gap-2" key={eventType}>
            <Checkbox
              checked={eventTypes.includes(eventType)}
              id={id}
              onCheckedChange={(checked) =>
                onChange(
                  checked === true
                    ? [...eventTypes, eventType]
                    : eventTypes.filter((value) => value !== eventType)
                )
              }
            />
            <Label htmlFor={id}>{eventType}</Label>
          </div>
        );
      })}
    </fieldset>
  );
}

function DeliveryHistory({
  connectionId,
  cursor,
  deliveries,
  isLoading,
  onLoadMore,
  onRetry,
}: {
  readonly connectionId: string;
  readonly cursor: string | null;
  readonly deliveries: DeliveryPage["items"];
  readonly isLoading: boolean;
  readonly onLoadMore: (cursor: string) => void;
  readonly onRetry: (deliveryId: DeliveryPage["items"][number]["id"]) => void;
}) {
  return (
    <section
      aria-label="Webhook delivery history"
      className="rounded-xl border p-4"
    >
      <h2 className="font-medium">Delivery history</h2>
      <p className="text-muted-foreground text-xs">Endpoint {connectionId}</p>
      {deliveries.length === 0 && !isLoading ? (
        <p className="mt-3 text-muted-foreground text-sm">No deliveries yet.</p>
      ) : null}
      <div className="mt-3 divide-y">
        {deliveries.map((delivery) => (
          <details className="py-3" key={delivery.id}>
            <summary className="cursor-pointer text-sm">
              {delivery.eventType} · {delivery.state} · {delivery.attemptCount}{" "}
              attempts
            </summary>
            <ul
              aria-label={`Attempts for ${delivery.id}`}
              className="mt-2 grid gap-1 text-muted-foreground text-sm"
            >
              {delivery.attempts.map((attempt) => (
                <li key={attempt.id}>
                  {attempt.startedAt.toLocaleString()} ·{" "}
                  {attempt.httpStatus ?? "network"} · {attempt.retryDecision}
                  {attempt.errorTag === null ? "" : ` · ${attempt.errorTag}`}
                  {attempt.durationMs === null
                    ? ""
                    : ` · ${attempt.durationMs} ms`}
                </li>
              ))}
            </ul>
            {delivery.state === "exhausted" ? (
              <Button
                className="mt-2"
                onClick={() => onRetry(delivery.id)}
                size="sm"
                variant="outline"
              >
                Retry delivery
              </Button>
            ) : null}
          </details>
        ))}
      </div>
      {cursor === null ? null : (
        <Button
          disabled={isLoading}
          onClick={() => onLoadMore(cursor)}
          size="sm"
          variant="outline"
        >
          {isLoading ? "Loading…" : "Load more"}
        </Button>
      )}
    </section>
  );
}

const formatOptionalDate = (date: Date | null) =>
  date === null ? "never" : date.toLocaleString();

const loadEndpoints = (organizationId: string) =>
  fetchRpc((rpc) => rpc.WebhookEndpointList({ organizationId })).then(
    (result) => [...result]
  );

const loadDeliveries = (
  organizationId: string,
  connectionId: string,
  cursor?: string
) =>
  fetchRpc((rpc) =>
    rpc.WebhookDeliveryHistory({
      connectionId,
      ...(cursor === undefined ? {} : { cursor }),
      organizationId,
    })
  );
