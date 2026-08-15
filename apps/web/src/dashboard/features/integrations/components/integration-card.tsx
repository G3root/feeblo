import { useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import { Card, CardPanel } from "@feeblo/ui/card";
import { toastManager } from "@feeblo/ui/toast";
import { LockKeyIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import { useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type * as Atom from "effect/unstable/reactivity/Atom";
import { useState } from "react";
import { useUpgradePlanDialogContext } from "~/features/billing/dialog-stores";
import { useEntitlements } from "~/hooks/use-entitlements";

/** Minimal shape every provider connection exposes to the card. */
export type IntegrationConnection = {
  readonly lifecycle: string;
};

/** Route of the per-integration settings page behind the Configure action. */
export type IntegrationConfigureRoute =
  | "/$organizationId/settings/integrations/slack"
  | "/$organizationId/settings/integrations/discord"
  | "/$organizationId/settings/integrations/github";

/**
 * Provider-specific wiring for one integration card. Declared once per
 * provider as a module-level constant so the card itself stays generic and
 * every provider shares the same connection, entitlements, and layout logic.
 */
export type IntegrationCardConfig<C extends IntegrationConnection> = {
  readonly name: string;
  readonly icon: HugeiconsIconProps["icon"];
  readonly description: string;
  readonly statusAtom: Atom.Atom<AsyncResult.AsyncResult<boolean, unknown>>;
  readonly connectionsAtom: (
    organizationId: string
  ) => Atom.Atom<AsyncResult.AsyncResult<readonly C[], unknown>>;
  readonly startConnect: (
    organizationId: string
  ) => Promise<{ readonly authorizeUrl: URL }>;
  readonly connectErrorMessage: string;
  readonly connectLabel: (connecting: boolean) => string;
  readonly configureTo: IntegrationConfigureRoute;
  readonly connectionDetail?: (connections: readonly C[]) => string;
};

export function IntegrationCard<C extends IntegrationConnection>({
  organizationId,
  config,
}: {
  readonly organizationId: string;
  readonly config: IntegrationCardConfig<C>;
}) {
  const router = useRouter();
  const { entitlements, isLoading: isEntitlementsLoading } = useEntitlements();
  const [connecting, setConnecting] = useState(false);
  const connectionsResult = useAtomValue(
    config.connectionsAtom(organizationId)
  );
  const statusResult = useAtomValue(config.statusAtom);

  const configured = AsyncResult.match(statusResult, {
    onInitial: () => null as boolean | null,
    onFailure: () => false,
    onSuccess: ({ value }) => value,
  });

  const { connections, isLoading, loadFailed } = AsyncResult.match(
    connectionsResult,
    {
      onInitial: () => ({
        connections: [] as readonly C[],
        isLoading: true,
        loadFailed: false,
      }),
      onFailure: ({ previousSuccess }) =>
        Option.match(previousSuccess, {
          onNone: () => ({
            connections: [] as readonly C[],
            isLoading: false,
            loadFailed: true,
          }),
          onSome: ({ value }) => ({
            connections: value,
            isLoading: false,
            loadFailed: false,
          }),
        }),
      onSuccess: ({ value }) => ({
        connections: value,
        isLoading: false,
        loadFailed: false,
      }),
    }
  );

  const activeConnections = connections.filter(
    (connection) =>
      connection.lifecycle === "active" || connection.lifecycle === "connecting"
  );
  const connected = activeConnections.length > 0;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await config.startConnect(organizationId);
      window.location.assign(authorizeUrl.toString());
    } catch {
      setConnecting(false);
      toastManager.add({
        title: config.connectErrorMessage,
        type: "error",
      });
    }
  };

  if (configured === null) {
    return (
      <Card>
        <CardPanel>
          <p className="text-muted-foreground text-sm">
            Loading {config.name}…
          </p>
        </CardPanel>
      </Card>
    );
  }
  if (!configured) {
    return null;
  }

  return (
    <Card>
      <CardPanel>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-lg border bg-muted p-2">
              <HugeiconsIcon className="size-5" icon={config.icon} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium">{config.name}</p>
                <ConnectionStatusBadge
                  connected={connected}
                  isLoading={isLoading}
                  loadFailed={loadFailed}
                />
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                {config.description}
              </p>
              {connected && config.connectionDetail ? (
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {config.connectionDetail(activeConnections)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="shrink-0">
            <IntegrationCardAction
              connecting={connecting}
              connectLabel={config.connectLabel(connecting)}
              entitlementsLoading={isEntitlementsLoading}
              mode={resolveActionMode(
                connected,
                entitlements.capabilities.integrations
              )}
              onConfigure={() =>
                router.navigate({
                  to: config.configureTo,
                  params: { organizationId },
                })
              }
              onConnect={handleConnect}
            />
          </div>
        </div>
      </CardPanel>
    </Card>
  );
}

function resolveActionMode(
  connected: boolean,
  entitled: boolean
): "configure" | "connect" | "locked" {
  if (connected) {
    return "configure";
  }
  if (entitled) {
    return "connect";
  }
  return "locked";
}

type IntegrationCardActionProps = {
  readonly onConfigure: () => void;
} & (
  | { readonly mode: "configure" }
  | {
      readonly mode: "connect";
      readonly connecting: boolean;
      readonly connectLabel: string;
      readonly onConnect: () => void;
    }
  | { readonly mode: "locked"; readonly entitlementsLoading: boolean }
);

function IntegrationCardAction(props: IntegrationCardActionProps) {
  if (props.mode === "configure") {
    return <Button onClick={props.onConfigure}>Configure</Button>;
  }
  if (props.mode === "connect") {
    return (
      <Button
        disabled={props.connecting}
        onClick={props.onConnect}
        variant="outline"
      >
        {props.connectLabel}
      </Button>
    );
  }
  return <ProLockedButton entitlementsLoading={props.entitlementsLoading} />;
}

function ProLockedButton({
  entitlementsLoading,
}: {
  entitlementsLoading: boolean;
}) {
  const upgradePlanStore = useUpgradePlanDialogContext();
  return (
    <Button
      disabled={entitlementsLoading}
      onClick={() => upgradePlanStore.send({ type: "toggle" })}
      variant="outline"
    >
      <HugeiconsIcon icon={LockKeyIcon} />
      Upgrade
    </Button>
  );
}

function ConnectionStatusBadge({
  connected,
  isLoading,
  loadFailed,
}: {
  readonly connected: boolean;
  readonly isLoading: boolean;
  readonly loadFailed: boolean;
}) {
  if (isLoading) {
    return <span className="text-muted-foreground text-xs">Checking…</span>;
  }
  if (loadFailed) {
    return <span className="text-destructive text-xs">Could not load</span>;
  }
  return connected ? (
    <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
      Connected
    </span>
  ) : (
    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
      Not connected
    </span>
  );
}
