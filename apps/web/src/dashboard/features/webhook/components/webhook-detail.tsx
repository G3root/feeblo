import {
  RegistryContext,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
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
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { toastManager } from "@feeblo/ui/toast";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect, useMemo, useState } from "react";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { fetchRpc } from "~/lib/runtime";
import {
  type DeliveryPage,
  deliveriesAtom,
  type Endpoint,
  endpointsAtom,
  webhookAtomRegistry,
} from "../atoms";
import {
  useWebhookEditSheetContext,
  WebhookEditSheetProvider,
} from "../dialog-stores";
import type { WebhookEventType } from "../shared-form";
import { WebhookEditSheet } from "./webhook-edit-sheet";
import { WebhookEventSelection } from "./webhook-events-selection";

export function WebhookDetail({
  connectionId,
  organizationId,
}: {
  readonly connectionId: string;
  readonly organizationId: string;
}) {
  return (
    <WebhookEditSheetProvider>
      <RegistryContext.Provider value={webhookAtomRegistry}>
        <WebhookDetailContent
          connectionId={connectionId}
          organizationId={organizationId}
        />
      </RegistryContext.Provider>
    </WebhookEditSheetProvider>
  );
}

function WebhookDetailContent({
  connectionId,
  organizationId,
}: {
  readonly connectionId: string;
  readonly organizationId: string;
}) {
  const navigate = useNavigate();
  const editSheetStore = useWebhookEditSheetContext();
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    readonly endpointName: string;
    readonly value: string;
  } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const endpointsResult = useAtomValue(endpointsAtom(organizationId));
  const refreshEndpoints = useAtomRefresh(endpointsAtom(organizationId));

  const { endpoint, isLoading, loadFailed } = useMemo(() => {
    const findEndpoint = (value: readonly Endpoint[]) =>
      value.find((candidate) => candidate.id === connectionId) ?? null;
    return AsyncResult.match(endpointsResult, {
      onInitial: () => ({ endpoint: null, isLoading: true, loadFailed: false }),
      onFailure: ({ previousSuccess }) =>
        Option.match(previousSuccess, {
          onNone: () => ({
            endpoint: null,
            isLoading: false,
            loadFailed: true,
          }),
          onSome: ({ value }) => ({
            endpoint: findEndpoint(value),
            isLoading: false,
            loadFailed: false,
          }),
        }),
      onSuccess: ({ value }) => ({
        endpoint: findEndpoint(value),
        isLoading: false,
        loadFailed: false,
      }),
    });
  }, [connectionId, endpointsResult]);

  const handleTest = async (endpoint: Endpoint) => {
    try {
      const result = await fetchRpc((rpc) =>
        rpc.WebhookTestDelivery({
          connectionId: endpoint.id,
          organizationId,
        })
      );
      setTestResult(`${result.result}: ${result.deliveryId}`);
      toastManager.add({ title: "Test delivery queued", type: "success" });
    } catch {
      toastManager.add({
        title: "Could not queue test delivery",
        type: "error",
      });
    }
  };

  const handleRotateSecret = async (endpoint: Endpoint) => {
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
  };

  const handleToggleLifecycle = async (endpoint: Endpoint) => {
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
      refreshEndpoints();
    } catch {
      toastManager.add({
        title: "Could not change endpoint lifecycle",
        type: "error",
      });
    }
  };

  const updateEvents = async (
    endpoint: Endpoint,
    nextEventTypes: readonly WebhookEventType[]
  ) => {
    try {
      await fetchRpc((rpc) =>
        rpc.WebhookEndpointUpdate({
          connectionId: endpoint.id,
          eventTypes: [...nextEventTypes],
          organizationId,
        })
      );
      refreshEndpoints();
    } catch {
      toastManager.add({
        title: "Could not update event selection",
        type: "error",
      });
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) {
      return;
    }
    try {
      await fetchRpc((rpc) =>
        rpc.WebhookEndpointRemove({ connectionId, organizationId })
      );
      refreshEndpoints();
      toastManager.add({ title: "Webhook endpoint removed", type: "success" });
      await navigate({
        params: { organizationId },
        to: "/$organizationId/settings/webhooks",
      });
    } catch {
      toastManager.add({
        title: "Could not remove webhook endpoint",
        type: "error",
      });
    }
  };

  return (
    <>
      <SettingsLayout.Header>
        <Link
          className="text-muted-foreground text-sm hover:text-foreground"
          params={{ organizationId }}
          to="/$organizationId/settings/webhooks"
        >
          ← Back to endpoints
        </Link>
        <SettingsLayout.HeaderTitle>
          {endpoint === null ? "Webhook endpoint" : endpoint.name}
        </SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Manage the endpoint, its subscribed events, and delivery history.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div className="grid gap-4">
          {isLoading ? (
            <Card>
              <CardPanel>
                <p className="text-muted-foreground text-sm">
                  Loading endpoint…
                </p>
              </CardPanel>
            </Card>
          ) : null}
          {loadFailed ? (
            <Card>
              <CardPanel>
                <div className="text-sm">
                  Endpoint could not be loaded.{" "}
                  <Button
                    onClick={refreshEndpoints}
                    size="sm"
                    variant="outline"
                  >
                    Try again
                  </Button>
                </div>
              </CardPanel>
            </Card>
          ) : null}
          {endpoint === null && !isLoading && !loadFailed ? (
            <Card>
              <CardHeader>
                <CardTitle>Endpoint not found</CardTitle>
                <CardDescription>
                  It may have been removed from this organization.
                </CardDescription>
              </CardHeader>
              <CardPanel>
                <Button
                  render={(buttonProps) => (
                    <Link
                      {...buttonProps}
                      params={{ organizationId }}
                      to="/$organizationId/settings/webhooks"
                    />
                  )}
                  size="sm"
                  variant="outline"
                >
                  Back to endpoints
                </Button>
              </CardPanel>
            </Card>
          ) : null}
          {endpoint === null ? null : (
            <>
              {oneTimeSecret === null ? null : (
                <section
                  aria-label="Webhook signing secret"
                  className="rounded-xl border border-warning/30 bg-warning/5 p-4"
                >
                  <h2 className="font-medium">Copy the signing secret now</h2>
                  <p className="mt-1 text-muted-foreground text-sm">
                    This secret for {oneTimeSecret.endpointName} will not be
                    shown again.
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
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="grid min-w-0 gap-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-base">
                          {endpoint.name}
                        </CardTitle>
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
                      <CardDescription>{endpoint.hostname}</CardDescription>
                      <CardDescription className="text-xs">
                        Last success:{" "}
                        {formatOptionalDate(endpoint.lastSucceededAt)} · Last
                        failure: {formatOptionalDate(endpoint.lastFailedAt)}
                      </CardDescription>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => handleTest(endpoint)}
                        size="sm"
                        variant="outline"
                      >
                        Test
                      </Button>
                      <Button
                        onClick={() =>
                          editSheetStore.send({
                            type: "setOpen",
                            open: true,
                            data: { endpoint },
                          })
                        }
                        size="sm"
                        variant="outline"
                      >
                        Edit
                      </Button>
                      <Button
                        onClick={() => handleRotateSecret(endpoint)}
                        size="sm"
                        variant="outline"
                      >
                        Rotate secret
                      </Button>
                      <Button
                        onClick={() => handleToggleLifecycle(endpoint)}
                        size="sm"
                        variant="outline"
                      >
                        {endpoint.lifecycle === "paused" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        onClick={() => setConfirmRemove(true)}
                        size="sm"
                        variant="destructive"
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardPanel>
                  <WebhookEventSelection
                    eventTypes={endpoint.eventTypes}
                    idPrefix={endpoint.id}
                    onChange={(next) => updateEvents(endpoint, next)}
                  />
                </CardPanel>
              </Card>
              {testResult === null ? null : (
                <p aria-live="polite" className="text-muted-foreground text-sm">
                  Latest test delivery: {testResult}
                </p>
              )}
              <DeliveryHistoryTable
                connectionId={connectionId}
                organizationId={organizationId}
              />
            </>
          )}
        </div>
      </SettingsLayout.Content>

      <WebhookEditSheet />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) {
            setConfirmRemove(false);
          }
        }}
        open={confirmRemove}
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
            <AlertDialogAction onClick={handleRemove}>
              Remove endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}

const deliveryStateBadge = {
  canceled: "secondary",
  exhausted: "destructive",
  leased: "secondary",
  pending: "secondary",
  succeeded: "default",
} as const;

function DeliveryHistoryTable({
  organizationId,
  connectionId,
}: {
  readonly organizationId: string;
  readonly connectionId: string;
}) {
  const [deliveries, setDeliveries] = useState<DeliveryPage["items"]>([]);
  const [deliveryCursor, setDeliveryCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState<readonly string[]>([]);

  const historyAtom = useMemo(
    () => deliveriesAtom(organizationId, connectionId, deliveryCursor),
    [connectionId, deliveryCursor, organizationId]
  );
  const historyResult = useAtomValue(historyAtom);
  const refreshHistory = useAtomRefresh(historyAtom);

  // The first page auto-loads on mount (see `revalidateOnMount` on the atom);
  // later pages load via the Load more button. Append or replace the visible
  // list whenever a requested page resolves.
  useEffect(() => {
    if (AsyncResult.isSuccess(historyResult)) {
      const page = historyResult.value;
      setDeliveries((current) =>
        deliveryCursor === null ? page.items : [...current, ...page.items]
      );
      setDeliveryCursor(page.nextCursor);
      setIsLoading(false);
    } else if (AsyncResult.isFailure(historyResult)) {
      setIsLoading(false);
      toastManager.add({
        title: "Could not load delivery history",
        type: "error",
      });
    }
  }, [deliveryCursor, historyResult]);

  // Reload the newest page: reset the visible list and re-fetch page one.
  const reloadHistory = () => {
    setIsLoading(true);
    setDeliveries([]);
    if (deliveryCursor === null) {
      refreshHistory();
    } else {
      setDeliveryCursor(null);
    }
  };

  const loadMore = () => {
    setIsLoading(true);
    refreshHistory();
  };

  const toggleExpanded = (deliveryId: string) =>
    setExpanded((current) =>
      current.includes(deliveryId)
        ? current.filter((id) => id !== deliveryId)
        : [...current, deliveryId]
    );

  const handleRetry = async (
    deliveryId: DeliveryPage["items"][number]["id"]
  ) => {
    try {
      await fetchRpc((rpc) =>
        rpc.WebhookDeliveryRetry({ deliveryId, organizationId })
      );
      toastManager.add({ title: "Delivery retry queued", type: "success" });
      reloadHistory();
    } catch {
      toastManager.add({ title: "Could not retry delivery", type: "error" });
    }
  };

  return (
    <Card aria-label="Webhook delivery history">
      {" "}
      <CardHeader>
        <CardTitle>Delivery history</CardTitle>
        <CardDescription>Endpoint {connectionId}</CardDescription>
        <CardAction>
          <Button onClick={reloadHistory} size="sm" variant="outline">
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel>
        {deliveries.length === 0 && !isLoading ? (
          <p className="text-muted-foreground text-sm">No deliveries yet.</p>
        ) : null}
        {deliveries.length === 0 ? null : (
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead>Started at</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deliveries.flatMap((delivery) => {
                const isExpanded = expanded.includes(delivery.id);
                return [
                  <TableRow
                    className="cursor-pointer"
                    data-state={isExpanded ? "selected" : undefined}
                    key={delivery.id}
                    onClick={() => toggleExpanded(delivery.id)}
                  >
                    <TableCell className="font-medium">
                      {delivery.eventType}
                    </TableCell>
                    <TableCell>
                      <Badge variant={deliveryStateBadge[delivery.state]}>
                        {delivery.state}
                      </Badge>
                    </TableCell>
                    <TableCell>{delivery.attemptCount}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {delivery.createdAt.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {delivery.state === "exhausted" ? (
                        <Button
                          onClick={(event) => {
                            event.stopPropagation();
                            handleRetry(delivery.id);
                          }}
                          size="sm"
                          variant="outline"
                        >
                          Retry
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>,
                  isExpanded ? (
                    <TableRow key={`${delivery.id}-attempts`}>
                      <TableCell
                        className="whitespace-normal bg-muted/40"
                        colSpan={5}
                      >
                        <ul
                          aria-label={`Attempts for ${delivery.id}`}
                          className="grid gap-1 text-muted-foreground text-sm"
                        >
                          {delivery.attempts.map((attempt) => (
                            <li key={attempt.id}>
                              {attempt.startedAt.toLocaleString()} ·{" "}
                              {attempt.httpStatus ?? "network"} ·{" "}
                              {attempt.retryDecision ?? "in progress"}
                              {attempt.errorTag === null
                                ? ""
                                : ` · ${attempt.errorTag}`}
                              {attempt.durationMs === null
                                ? ""
                                : ` · ${attempt.durationMs} ms`}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  ) : null,
                ];
              })}
            </TableBody>
          </Table>
        )}
      </CardPanel>
      {deliveryCursor === null ? null : (
        <CardFooter className="justify-start">
          <Button
            disabled={isLoading}
            onClick={loadMore}
            size="sm"
            variant="outline"
          >
            {isLoading ? "Loading…" : "Load more"}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}

const formatOptionalDate = (date: Date | null) =>
  date === null ? "never" : date.toLocaleString();
