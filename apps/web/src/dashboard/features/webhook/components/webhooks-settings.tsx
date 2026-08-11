import {
  RegistryContext,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardFrame,
  CardFrameAction,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { toastManager } from "@feeblo/ui/toast";
import { Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useMemo, useState } from "react";
import { type Endpoint, endpointsAtom, webhookAtomRegistry } from "../atoms";
import { useWebhookCreateDialogContext } from "../dialog-stores";
import {
  type CreatedWebhookEndpoint,
  WebhookCreateDialog,
} from "./webhook-create-dialog";

export function WebhooksSettings({
  organizationId,
}: {
  organizationId: string;
}) {
  return (
    <RegistryContext.Provider value={webhookAtomRegistry}>
      <WebhooksSettingsContent organizationId={organizationId} />
    </RegistryContext.Provider>
  );
}

function WebhooksSettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const createDialogStore = useWebhookCreateDialogContext();
  const [oneTimeSecret, setOneTimeSecret] = useState<{
    readonly endpointName: string;
    readonly value: string;
  } | null>(null);

  const endpointsResult = useAtomValue(endpointsAtom(organizationId));
  const refreshEndpoints = useAtomRefresh(endpointsAtom(organizationId));

  const { endpoints, isLoading, loadFailed } = useMemo(
    () =>
      AsyncResult.match(endpointsResult, {
        onInitial: () => ({
          endpoints: [],
          isLoading: true,
          loadFailed: false,
        }),
        onFailure: ({ previousSuccess }) =>
          Option.match(previousSuccess, {
            onNone: () => ({
              endpoints: [],
              isLoading: false,
              loadFailed: true,
            }),
            onSome: ({ value }) => ({
              endpoints: value,
              isLoading: false,
              loadFailed: false,
            }),
          }),
        onSuccess: ({ value }) => ({
          endpoints: value,
          isLoading: false,
          loadFailed: false,
        }),
      }),
    [endpointsResult]
  );

  const handleCreated = (endpoint: CreatedWebhookEndpoint) => {
    setOneTimeSecret({
      endpointName: endpoint.endpointName,
      value: endpoint.signingSecret,
    });
    refreshEndpoints();
    toastManager.add({ title: "Webhook endpoint created", type: "success" });
  };

  return (
    <>
      <div className="grid gap-4">
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
        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>Endpoints</CardFrameTitle>
            <CardFrameDescription>
              Deliver signed feedback events to your HTTPS endpoint.
            </CardFrameDescription>
            <CardFrameAction>
              <Button
                onClick={() => createDialogStore.send({ type: "toggle" })}
                type="button"
              >
                <HugeiconsIcon icon={Plus} />
                New endpoint
              </Button>
            </CardFrameAction>
          </CardFrameHeader>
          {isLoading ? (
            <Card>
              <CardPanel>
                <p className="text-muted-foreground text-sm">
                  Loading endpoints…
                </p>
              </CardPanel>
            </Card>
          ) : null}
          {loadFailed ? (
            <Card>
              <CardPanel>
                <div className="text-sm">
                  Endpoints could not be loaded.{" "}
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
          {!(isLoading || loadFailed) && endpoints.length === 0 ? (
            <Card>
              <CardPanel>
                <p className="py-4 text-center text-muted-foreground text-sm">
                  No webhook endpoints yet.
                </p>
              </CardPanel>
            </Card>
          ) : null}
          {endpoints.map((endpoint) => (
            <WebhookEndpointCard
              endpoint={endpoint}
              key={endpoint.id}
              organizationId={organizationId}
            />
          ))}
        </CardFrame>
      </div>

      <WebhookCreateDialog onCreated={handleCreated} />
    </>
  );
}

function WebhookEndpointCard({
  endpoint,
  organizationId,
}: {
  readonly endpoint: Endpoint;
  readonly organizationId: string;
}) {
  return (
    <Card render={<article />}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="text-base">{endpoint.name}</CardTitle>
              <Badge>{endpoint.lifecycle}</Badge>
              <Badge
                variant={
                  endpoint.health === "failing" ? "destructive" : "outline"
                }
              >
                {endpoint.health}
              </Badge>
            </div>
            <CardDescription>{endpoint.hostname}</CardDescription>
            <CardDescription className="text-xs">
              Last success: {formatOptionalDate(endpoint.lastSucceededAt)} ·
              Last failure: {formatOptionalDate(endpoint.lastFailedAt)}
            </CardDescription>
          </div>
          <Button
            render={(buttonProps) => (
              <Link
                {...buttonProps}
                params={{
                  connectionId: endpoint.id,
                  organizationId,
                }}
                to="/$organizationId/settings/webhooks/$connectionId"
              />
            )}
            size="sm"
            variant="outline"
          >
            Details
          </Button>
        </div>
      </CardHeader>
      <CardPanel>
        <p className="text-muted-foreground text-xs">
          Events: {endpoint.eventTypes.join(", ")}
        </p>
      </CardPanel>
    </Card>
  );
}

const formatOptionalDate = (date: Date | null) =>
  date === null ? "never" : date.toLocaleString();
