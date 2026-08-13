import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import { Card, CardPanel } from "@feeblo/ui/card";
import { toastManager } from "@feeblo/ui/toast";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { Chat01Icon, ChatBotIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useEffect, useState } from "react";
import { z } from "zod";
import {
  discordAtomRegistry,
  connectionsAtom as discordConnectionsAtom,
  discordStatusAtom,
} from "~/features/discord/atoms";
import {
  type loadConnections as loadDiscordConnections,
  startDiscordConnect,
} from "~/features/discord/lib/connections";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import {
  connectionsAtom,
  slackAtomRegistry,
  slackStatusAtom,
} from "~/features/slack/atoms";
import {
  type loadConnections,
  startSlackConnect,
} from "~/features/slack/lib/connections";
import { useOrganizationId } from "~/hooks/use-organization-id";

export const Route = createFileRoute("/$organizationId/settings/integrations/")(
  {
    validateSearch: (search) =>
      z
        .object({
          discord: z.enum(["connected", "error"]).optional(),
          slack: z.enum(["connected", "error"]).optional(),
          message: z.string().min(1).optional(),
        })
        .parse(search),
    component: IntegrationsSettingsRoute,
  }
);

function IntegrationsSettingsRoute() {
  const organizationId = useOrganizationId();
  const { allowed, isPending } = usePolicy(
    hasPermission(organizationId, "integrations.manage")
  );
  const search = Route.useSearch();
  const router = useRouter();

  // Surface the result of the Slack and Discord OAuth install flows the
  // server redirected back with, then strip the query params so the notice
  // shows only once.
  useEffect(() => {
    if (search.slack !== undefined) {
      if (search.slack === "connected") {
        toastManager.add({ title: "Slack connected", type: "success" });
      } else {
        toastManager.add({
          title: search.message ?? "Could not connect Slack",
          type: "error",
        });
      }
    } else if (search.discord !== undefined) {
      if (search.discord === "connected") {
        toastManager.add({ title: "Discord connected", type: "success" });
      } else {
        toastManager.add({
          title: search.message ?? "Could not connect Discord",
          type: "error",
        });
      }
    } else {
      return;
    }
    router.navigate({
      to: "/$organizationId/settings/integrations",
      params: { organizationId },
      search: {},
      replace: true,
    });
  }, [organizationId, router, search.discord, search.message, search.slack]);

  if (isPending) {
    return null;
  }
  if (!allowed) {
    return <SettingsAccessDenied />;
  }

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Integrations</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Connect the tools your team uses every day to Feeblo.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div className="grid gap-4">
          <RegistryContext.Provider value={slackAtomRegistry}>
            <SlackIntegrationCard organizationId={organizationId} />
          </RegistryContext.Provider>
          <RegistryContext.Provider value={discordAtomRegistry}>
            <DiscordIntegrationCard organizationId={organizationId} />
          </RegistryContext.Provider>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

function connectionStatusBadge({
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

function SlackIntegrationCard({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const connectionsResult = useAtomValue(connectionsAtom(organizationId));
  const statusResult = useAtomValue(slackStatusAtom);
  const slackConfigured = AsyncResult.match(statusResult, {
    onInitial: () => null as boolean | null,
    onFailure: () => false,
    onSuccess: ({ value }) => value,
  });

  const { connections, isLoading, loadFailed } = AsyncResult.match(
    connectionsResult,
    {
      onInitial: () => ({
        connections: [] as Awaited<ReturnType<typeof loadConnections>>,
        isLoading: true,
        loadFailed: false,
      }),
      onFailure: ({ previousSuccess }) =>
        Option.match(previousSuccess, {
          onNone: () => ({
            connections: [],
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
      const { authorizeUrl } = await startSlackConnect(organizationId);
      window.location.assign(authorizeUrl.toString());
    } catch {
      setConnecting(false);
      toastManager.add({
        title: "Could not start Slack connection",
        type: "error",
      });
    }
  };

  if (slackConfigured === null) {
    return (
      <Card>
        <CardPanel>
          <p className="text-muted-foreground text-sm">Loading Slack…</p>
        </CardPanel>
      </Card>
    );
  }
  if (!slackConfigured) {
    return null;
  }

  return (
    <Card>
      <CardPanel>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-lg border bg-muted p-2">
              <HugeiconsIcon className="size-5" icon={Chat01Icon} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium">Slack</p>
                {connectionStatusBadge({ isLoading, loadFailed, connected })}
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                Let your team send feedback with /feeblo, forward messages with
                “Send to Feeblo”, and get new requests posted to your channels.
              </p>
              {connected ? (
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {activeConnections
                    .map((connection) => connection.teamName)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="shrink-0">
            {connected ? (
              <Button
                onClick={() =>
                  router.navigate({
                    to: "/$organizationId/settings/integrations/slack",
                    params: { organizationId },
                  })
                }
              >
                Configure
              </Button>
            ) : (
              <Button
                disabled={connecting}
                onClick={handleConnect}
                variant="outline"
              >
                {connecting ? "Redirecting…" : "Connect"}
              </Button>
            )}
          </div>
        </div>
      </CardPanel>
    </Card>
  );
}

function DiscordIntegrationCard({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const router = useRouter();
  const [connecting, setConnecting] = useState(false);
  const connectionsResult = useAtomValue(
    discordConnectionsAtom(organizationId)
  );
  const statusResult = useAtomValue(discordStatusAtom);
  const discordConfigured = AsyncResult.match(statusResult, {
    onInitial: () => null as boolean | null,
    onFailure: () => false,
    onSuccess: ({ value }) => value,
  });

  const { connections, isLoading, loadFailed } = AsyncResult.match(
    connectionsResult,
    {
      onInitial: () => ({
        connections: [] as Awaited<ReturnType<typeof loadDiscordConnections>>,
        isLoading: true,
        loadFailed: false,
      }),
      onFailure: ({ previousSuccess }) =>
        Option.match(previousSuccess, {
          onNone: () => ({
            connections: [],
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
      const { authorizeUrl } = await startDiscordConnect(organizationId);
      window.location.assign(authorizeUrl.toString());
    } catch {
      setConnecting(false);
      toastManager.add({
        title: "Could not start Discord connection",
        type: "error",
      });
    }
  };

  if (discordConfigured === null) {
    return (
      <Card>
        <CardPanel>
          <p className="text-muted-foreground text-sm">Loading Discord…</p>
        </CardPanel>
      </Card>
    );
  }
  if (!discordConfigured) {
    return null;
  }

  return (
    <Card>
      <CardPanel>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 shrink-0 rounded-lg border bg-muted p-2">
              <HugeiconsIcon className="size-5" icon={ChatBotIcon} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium">Discord</p>
                {connectionStatusBadge({ isLoading, loadFailed, connected })}
              </div>
              <p className="mt-1 text-muted-foreground text-sm">
                Let your team send feedback with /feeblo, forward messages with
                “Send to Feeblo”, and get new requests posted to your channels.
              </p>
              {connected ? (
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {activeConnections
                    .map((connection) => connection.guildName)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </div>
          <div className="shrink-0">
            {connected ? (
              <Button
                onClick={() =>
                  router.navigate({
                    to: "/$organizationId/settings/integrations/discord",
                    params: { organizationId },
                  })
                }
              >
                Configure
              </Button>
            ) : (
              <Button
                disabled={connecting}
                onClick={handleConnect}
                variant="outline"
              >
                {connecting ? "Redirecting…" : "Connect"}
              </Button>
            )}
          </div>
        </div>
      </CardPanel>
    </Card>
  );
}
