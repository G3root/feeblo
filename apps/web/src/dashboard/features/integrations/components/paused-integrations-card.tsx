import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { toastManager } from "@feeblo/ui/toast";
import { LinkBackwardIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useState } from "react";

import { useDowngradeState } from "~/hooks/use-downgrade-state";
import { workspacePlanCollection } from "~/lib/collections";

/** Minimal shape every provider connection exposes to the cleanup list. */
export type PausedConnection = {
  readonly id: string;
  readonly lifecycle: string;
};

type DisconnectAtom = Atom.AtomResultFn<
  {
    readonly payload: {
      readonly connectionId: string;
      readonly organizationId: string;
    };
    readonly reactivityKeys?:
      | ReadonlyArray<unknown>
      | Readonly<Record<string, ReadonlyArray<unknown>>>;
  },
  void,
  unknown
>;

/** Provider-specific wiring for one cleanup row group. */
export type PausedIntegrationsProviderConfig<C extends PausedConnection> = {
  readonly name: string;
  readonly connectionsAtom: (
    organizationId: string
  ) => Atom.Atom<Result.AsyncResult<readonly C[], unknown>>;
  readonly disconnectAtom: DisconnectAtom;
  readonly reactivityKeys: (
    organizationId: string
  ) => Readonly<Record<string, ReadonlyArray<unknown>>>;
  readonly connectionLabel: (connection: C) => string;
  readonly disconnectErrorMessage: string;
};

const LIFECYCLE_LABELS = {
  active: "Active",
  connecting: "Connecting",
  paused: "Paused",
  reauth_required: "Needs reconnection",
  revocation_unconfirmed: "Revoking",
  disconnecting: "Disconnecting",
} as const satisfies Record<string, string>;

const lifecycleLabel = (lifecycle: string): string => {
  if (lifecycle in LIFECYCLE_LABELS) {
    // SAFETY: the `in` check above proves `lifecycle` is one of the known label keys.
    return LIFECYCLE_LABELS[lifecycle as keyof typeof LIFECYCLE_LABELS];
  }
  return lifecycle;
};

/**
 * Cleanup list rendered on the integrations settings page while the workspace
 * is downgraded: every held connection with an explicit disconnect action.
 * Disconnecting the last connection clears the derived downgrade state.
 */
export function PausedIntegrationsCard<C extends PausedConnection>({
  organizationId,
  providers,
}: {
  readonly organizationId: string;
  readonly providers: readonly PausedIntegrationsProviderConfig<C>[];
}) {
  const downgradeState = useDowngradeState();
  if (downgradeState?.isDowngraded !== true) {
    return null;
  }
  return (
    <Card>
      <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Paused integrations</CardTitle>
          <CardDescription>
            The Free plan doesn&rsquo;t include Slack, Discord, and GitHub
            integrations. These connections are kept but their deliveries are
            paused. Disconnect the ones you don&rsquo;t need, or upgrade to
            resume them.
          </CardDescription>
        </div>
      </CardHeader>
      <CardPanel className="grid gap-3">
        {providers.map((provider) => (
          <PausedProviderSection
            key={provider.name}
            organizationId={organizationId}
            provider={provider}
          />
        ))}
      </CardPanel>
    </Card>
  );
}

function PausedProviderSection<C extends PausedConnection>({
  organizationId,
  provider,
}: {
  readonly organizationId: string;
  readonly provider: PausedIntegrationsProviderConfig<C>;
}) {
  const connectionsResult = useAtomValue(
    provider.connectionsAtom(organizationId)
  );

  const { connections } = Result.builder(connectionsResult)
    .onInitial(() => ({
      // SAFETY: Empty-state placeholder: an empty collection is valid until the async source resolves.
      connections: [] as readonly C[],
    }))
    .onFailure(() => ({
      // SAFETY: Empty-state placeholder: the row still renders without counts when the list cannot load.
      connections: [] as readonly C[],
    }))
    .onSuccess((value) => ({ connections: value }))
    .exhaustive();

  const heldConnections = connections.filter(
    (connection) => connection.lifecycle !== "archived"
  );
  if (heldConnections.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{provider.name}</p>
        <p className="text-muted-foreground text-xs">
          {heldConnections.length === 1
            ? "1 connection"
            : `${heldConnections.length} connections`}
        </p>
      </div>
      <div className="mt-2 grid gap-2">
        {heldConnections.map((connection) => (
          <PausedConnectionRow
            key={connection.id}
            connection={connection}
            organizationId={organizationId}
            provider={provider}
          />
        ))}
      </div>
    </div>
  );
}

function PausedConnectionRow<C extends PausedConnection>({
  connection,
  organizationId,
  provider,
}: {
  readonly connection: C;
  readonly organizationId: string;
  readonly provider: PausedIntegrationsProviderConfig<C>;
}) {
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnect = useAtomSet(provider.disconnectAtom, {
    mode: "promise",
  });

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnect({
        payload: {
          connectionId: connection.id,
          organizationId,
        },
        reactivityKeys: provider.reactivityKeys(organizationId),
      });
      setDisconnecting(false);
      toastManager.add({
        title: `${provider.name} disconnected`,
        type: "success",
      });
      // The downgrade state is derived from live connection counts; refresh
      // the plan collection so banners and counts clear immediately.
      await workspacePlanCollection.utils.refetch();
    } catch {
      setDisconnecting(false);
      toastManager.add({
        title: provider.disconnectErrorMessage,
        type: "error",
      });
    }
  };

  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-sm">
          {provider.connectionLabel(connection)}
        </p>
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
          {lifecycleLabel(connection.lifecycle)}
        </span>
      </div>
      <Button
        disabled={disconnecting}
        onClick={handleDisconnect}
        size="sm"
        type="button"
        variant="outline"
      >
        <HugeiconsIcon icon={LinkBackwardIcon} />
        Disconnect
      </Button>
    </div>
  );
}
