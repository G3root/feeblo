import {
  RegistryContext,
  useAtomRefresh,
  useAtomSet,
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
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { CopyButton } from "@feeblo/ui/copy-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { toastManager } from "@feeblo/ui/toast";
import {
  Link,
  useElementScrollRestoration,
  useNavigate,
} from "@tanstack/react-router";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useLayoutEffect, useMemo, useRef, useState } from "react";

import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useScrollBottom } from "~/hooks/use-scroll-bottom";
import { fetchRpc } from "~/lib/runtime";

import {
  type Delivery,
  deliveriesAtom,
  deliveriesLoadingAtom,
  deliveryHistoryRefreshAtom,
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
  // Mutations that create or change deliveries (test, retry) bump this to
  // restart the history stream so new rows appear without a manual refresh.
  const refreshDeliveryHistory = useAtomSet(
    deliveryHistoryRefreshAtom({ connectionId, organizationId })
  );

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
    // Clear any previous result up front, so an in-flight or failed test never
    // shows stale delivery information.
    setTestResult(null);
    try {
      const result = await fetchRpc((rpc) =>
        rpc.WebhookTestDelivery({
          connectionId: endpoint.id,
          organizationId,
        })
      );
      setTestResult(`${result.result}: ${result.deliveryId}`);
      toastManager.add({ title: "Test delivery queued", type: "success" });
      refreshDeliveryHistory();
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
          className="text-muted-foreground hover:text-foreground text-sm"
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
                  className="border-warning/30 bg-warning/5 rounded-xl border p-4"
                >
                  <h2 className="font-medium">Copy the signing secret now</h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    This secret for {oneTimeSecret.endpointName} will not be
                    shown again.
                  </p>
                  <code className="bg-background mt-3 block rounded-md border p-3 text-sm break-all">
                    {oneTimeSecret.value}
                  </code>
                  <div className="mt-3 flex gap-2">
                    <CopyButton
                      aria-label="Copy Secret"
                      onCopy={() => oneTimeSecret.value}
                      size="sm"
                      successMessage="Signing secret copied to clipboard!"
                      tooltipPopup="Copy Secret"
                      variant="brand"
                    >
                      Copy Secret
                    </CopyButton>
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

type HistoryRow =
  | {
      readonly kind: "delivery";
      readonly key: string;
      readonly delivery: Delivery;
    }
  | {
      readonly kind: "attempts";
      readonly key: string;
      readonly delivery: Delivery;
    };

function DeliveryHistoryTable({
  organizationId,
  connectionId,
}: {
  readonly organizationId: string;
  readonly connectionId: string;
}) {
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const listRef = useRef<HTMLTableElement>(null);

  const historyArgs = useMemo(
    () => ({ organizationId, connectionId }),
    [connectionId, organizationId]
  );
  const historyResult = useAtomValue(deliveriesAtom(historyArgs));
  const isLoading = useAtomValue(deliveriesLoadingAtom(historyArgs));
  // Writing to the pull atom advances it one page (driven by scrolling to the
  // bottom, like the reference app); writing to the refresh atom restarts the
  // stream from the newest page. Both operations are owned by the atoms, so
  // the component no longer tracks cursors or accumulates pages itself.
  const pull = useAtomSet(deliveriesAtom(historyArgs));
  const refreshHistory = useAtomSet(deliveryHistoryRefreshAtom(historyArgs));
  useScrollBottom(() => {
    pull();
  });

  // Accumulated rows. The pull atom owns pagination, so the visible list is
  // whatever pages have streamed in so far, keeping the previous rows visible
  // while the next page (or a refresh) is in flight.
  const deliveries = AsyncResult.match(historyResult, {
    onInitial: () => [] as readonly Delivery[],
    onFailure: ({ previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => [] as readonly Delivery[],
        onSome: ({ value }) => value.items,
      }),
    onSuccess: ({ value }) => value.items,
  });

  // An empty history surfaces as `NoSuchElementError` (the paging stream ends
  // without emitting a chunk), so it renders as the empty state; every other
  // failure renders inline below.
  const hasLoadError = AsyncResult.matchWithError(historyResult, {
    onInitial: () => false,
    onSuccess: () => false,
    onError: (error) => error._tag !== "NoSuchElementError",
    onDefect: () => true,
  });

  const loadFailed = hasLoadError && deliveries.length === 0;

  const toggleExpanded = (deliveryId: string) =>
    setExpanded((current) =>
      current.includes(deliveryId)
        ? current.filter((id) => id !== deliveryId)
        : [...current, deliveryId]
    );

  const handleRetry = async (deliveryId: Delivery["id"]) => {
    try {
      await fetchRpc((rpc) =>
        rpc.WebhookDeliveryRetry({ deliveryId, organizationId })
      );
      toastManager.add({ title: "Delivery retry queued", type: "success" });
      refreshHistory();
    } catch {
      toastManager.add({ title: "Could not retry delivery", type: "error" });
    }
  };

  // Flat row list: an expanded delivery becomes two virtualized rows (the
  // delivery plus its attempts), so both get measured and scrolled together.
  const rows = useMemo<readonly HistoryRow[]>(
    () =>
      deliveries.flatMap((delivery) =>
        expanded.includes(delivery.id)
          ? [
              { kind: "delivery", key: delivery.id, delivery },
              { kind: "attempts", key: `${delivery.id}-attempts`, delivery },
            ]
          : [{ kind: "delivery", key: delivery.id, delivery }]
      ),
    [deliveries, expanded]
  );

  const scrollRestoration = useElementScrollRestoration({
    getElement: () => window,
  });
  // The virtualizer coordinates rows relative to the first body row, so its
  // scroll margin is the table's offset plus the measured header height.
  // Refs are only attached after commit, so the margin is measured in a
  // layout effect and stored in state; re-measuring when the row list changes
  // covers the table mounting after deliveries stream in.
  const headerRef = useRef<HTMLTableSectionElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    if (rows.length === 0) {
      return;
    }
    setScrollMargin(
      (listRef.current?.offsetTop ?? 0) + (headerRef.current?.offsetHeight ?? 0)
    );
  }, [rows.length]);
  const virtualizer = useWindowVirtualizer<HTMLTableRowElement>({
    count: rows.length,
    estimateSize: () => 44,
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: 6,
    scrollMargin,
    initialOffset: scrollRestoration?.scrollY,
  });

  // Only rows inside the viewport are rendered; invisible spacer rows above
  // and below keep the table's total height (and the window scrollbar)
  // accurate while the page scrolls.
  const virtualItems = virtualizer.getVirtualItems();
  const topSpacer =
    virtualItems.length > 0 ? virtualItems[0].start - scrollMargin : 0;
  const lastItem = virtualItems.at(-1);
  const bottomSpacer =
    lastItem === undefined
      ? 0
      : virtualizer.getTotalSize() - (lastItem.end - scrollMargin);

  return (
    <Card aria-label="Webhook delivery history">
      <CardHeader>
        <CardTitle>Delivery history</CardTitle>
        <CardDescription>Endpoint {connectionId}</CardDescription>
        <CardAction>
          <Button onClick={() => refreshHistory()} size="sm" variant="outline">
            Refresh
          </Button>
        </CardAction>
      </CardHeader>
      <CardPanel>
        {deliveries.length === 0 && isLoading ? (
          <p className="text-muted-foreground text-sm">
            Loading delivery history…
          </p>
        ) : null}
        {deliveries.length === 0 && !isLoading && loadFailed ? (
          <div className="text-sm">
            Delivery history could not be loaded.{" "}
            <Button
              onClick={() => refreshHistory()}
              size="sm"
              variant="outline"
            >
              Try again
            </Button>
          </div>
        ) : null}
        {deliveries.length === 0 && !isLoading && !loadFailed ? (
          <p className="text-muted-foreground text-sm">No deliveries yet.</p>
        ) : null}
        {deliveries.length === 0 ? null : (
          <>
            {hasLoadError ? (
              <p className="text-muted-foreground pb-2 text-sm">
                Could not load the latest deliveries.{" "}
                <button
                  className="underline"
                  onClick={() => refreshHistory()}
                  type="button"
                >
                  Try again
                </button>
              </p>
            ) : null}
            <Table ref={listRef} variant="card">
              <TableHeader ref={headerRef}>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Attempts</TableHead>
                  <TableHead>Started at</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {topSpacer > 0 ? (
                  <TableRow aria-hidden="true">
                    <TableCell
                      aria-hidden="true"
                      colSpan={5}
                      style={{ height: topSpacer }}
                    />
                  </TableRow>
                ) : null}
                {virtualItems.map((item) => {
                  const row = rows[item.index];
                  // The row list can shrink while a refresh is in flight (the
                  // new page hasn't streamed in yet), leaving stale virtual
                  // items with no backing row; skip those instead of reading
                  // `row.kind` off an undefined row.
                  if (row === undefined) {
                    return null;
                  }
                  return row.kind === "delivery" ? (
                    <DeliveryRow
                      dataIndex={item.index}
                      delivery={row.delivery}
                      expanded={expanded.includes(row.delivery.id)}
                      key={row.key}
                      measureRef={virtualizer.measureElement}
                      onRetry={handleRetry}
                      onToggle={toggleExpanded}
                    />
                  ) : (
                    <TableRow
                      className="border-b"
                      data-index={item.index}
                      key={row.key}
                      ref={virtualizer.measureElement}
                    >
                      <TableCell
                        className="bg-muted/40 whitespace-normal"
                        colSpan={5}
                      >
                        <ul
                          aria-label={`Attempts for ${row.delivery.id}`}
                          className="text-muted-foreground grid gap-1 text-sm"
                        >
                          {row.delivery.attempts.map((attempt) => (
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
                  );
                })}
                {bottomSpacer > 0 ? (
                  <TableRow aria-hidden="true">
                    <TableCell
                      aria-hidden="true"
                      colSpan={5}
                      style={{ height: bottomSpacer }}
                    />
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </>
        )}
      </CardPanel>
    </Card>
  );
}

function DeliveryRow({
  dataIndex,
  delivery,
  expanded,
  measureRef,
  onRetry,
  onToggle,
}: {
  readonly dataIndex: number;
  readonly delivery: Delivery;
  readonly expanded: boolean;
  readonly measureRef: (node: HTMLTableRowElement | null) => void;
  readonly onRetry: (deliveryId: Delivery["id"]) => void;
  readonly onToggle: (deliveryId: string) => void;
}) {
  return (
    <TableRow
      className="cursor-pointer"
      data-index={dataIndex}
      data-state={expanded ? "selected" : undefined}
      onClick={() => onToggle(delivery.id)}
      ref={measureRef}
    >
      <TableCell className="font-medium">{delivery.eventType}</TableCell>
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
              onRetry(delivery.id);
            }}
            size="sm"
            variant="outline"
          >
            Retry
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

const formatOptionalDate = (date: Date | null) =>
  date === null ? "never" : date.toLocaleString();
