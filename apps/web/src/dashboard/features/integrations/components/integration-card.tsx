import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import { Card, CardPanel } from "@feeblo/ui/card";
import { toastManager } from "@feeblo/ui/toast";
import { LockedIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import { useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Result from "effect/unstable/reactivity/AsyncResult";
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
 * every provider shares the same connection, connect flow, and layout logic.
 */
type StartConnectAtom = Atom.AtomResultFn<
  {
    readonly payload: { readonly organizationId: string };
    readonly reactivityKeys?:
      | ReadonlyArray<unknown>
      | Readonly<Record<string, ReadonlyArray<unknown>>>;
  },
  { readonly authorizeUrl: URL },
  unknown
>;

export type IntegrationCardConfig<C extends IntegrationConnection> = {
  readonly name: string;
  readonly icon: HugeiconsIconProps["icon"];
  readonly description: string;
  readonly reactivityKey: string;
  readonly statusAtom: Atom.Atom<Result.AsyncResult<boolean, unknown>>;
  readonly connectionsAtom: (
    organizationId: string
  ) => Atom.Atom<Result.AsyncResult<readonly C[], unknown>>;
  readonly startConnectAtom: StartConnectAtom;
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
  const startConnect = useAtomSet(config.startConnectAtom, {
    mode: "promise",
  });
  const connectionsResult = useAtomValue(
    config.connectionsAtom(organizationId)
  );
  const statusResult = useAtomValue(config.statusAtom);

  const configured = Result.builder(statusResult)
    .onInitial(
      // SAFETY: Loading/empty-state placeholder: null is valid until the async source resolves.
      () => null as boolean | null
    )
    .onFailure(() => false)
    .onSuccess((value) => value)
    .exhaustive();

  const { connections, isLoading, loadFailed } = Result.builder(
    connectionsResult
  )
    .onInitial(() => ({
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      connections: [] as readonly C[],
      isLoading: true,
      loadFailed: false,
    }))
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
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
      })
    )
    .onSuccess((value) => ({
      connections: value,
      isLoading: false,
      loadFailed: false,
    }))
    .exhaustive();

  const activeConnections = connections.filter(
    (connection) =>
      connection.lifecycle === "active" || connection.lifecycle === "connecting"
  );
  const connected = activeConnections.length > 0;

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await startConnect({
        payload: { organizationId },
        reactivityKeys: { [config.reactivityKey]: [organizationId] },
      });
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
            <div className="bg-muted mt-0.5 shrink-0 rounded-lg border p-2">
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
              <p className="text-muted-foreground mt-1 text-sm">
                {config.description}
              </p>
              {connected && config.connectionDetail ? (
                <p className="text-muted-foreground mt-1 truncate text-xs">
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
      <HugeiconsIcon icon={LockedIcon} />
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
    <span className="bg-success/10 text-success rounded-full px-2 py-0.5 text-xs font-medium">
      Connected
    </span>
  ) : (
    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
      Not connected
    </span>
  );
}
