import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { Card, CardPanel } from "@feeblo/ui/card";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@feeblo/ui/frame";
import { Switch } from "@feeblo/ui/switch";
import { toastManager } from "@feeblo/ui/toast";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import { useState } from "react";

import { useAsyncList } from "~/lib/use-async-list";

import {
  channelsAtom,
  connectionsAtom,
  discordReactivityKeys,
  disconnectDiscordConnectionAtom,
  type DiscordChannel,
  type DiscordConnection,
  discordStatusAtom,
  startDiscordConnectAtom,
  updateDiscordChannelNotificationsAtom,
} from "../atoms";

export function DiscordSettings({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  return <DiscordSettingsContent organizationId={organizationId} />;
}

function DiscordSettingsContent({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const startConnect = useAtomSet(startDiscordConnectAtom, { mode: "promise" });
  const connectionsResult = useAtomValue(connectionsAtom(organizationId));
  const refreshConnections = useAtomRefresh(connectionsAtom(organizationId));
  const {
    list: connections,
    isLoading,
    loadFailed,
  } = useAsyncList<DiscordConnection>(connectionsResult);
  const statusResult = useAtomValue(discordStatusAtom);
  const discordConfigured = Result.builder(statusResult)
    .onInitial(
      // SAFETY: Loading/empty-state placeholder: null is valid until the async source resolves.
      () => null as boolean | null
    )
    .onFailure(() => false)
    .onSuccess((value) => value)
    .exhaustive();

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const { authorizeUrl } = await startConnect({
        payload: { organizationId },
        reactivityKeys: discordReactivityKeys(organizationId),
      });
      window.location.assign(authorizeUrl.toString());
    } catch {
      setConnecting(false);
      toastManager.add({
        title: "Could not start Discord connection",
        type: "error",
      });
    }
  };

  const handleDisconnected = () => {
    toastManager.add({
      title: "Discord server disconnected",
      type: "success",
    });
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
    return (
      <Card>
        <CardPanel>
          <p className="text-muted-foreground text-sm">
            Discord is not configured for this deployment.
          </p>
        </CardPanel>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <CardPanel>
          <p className="text-muted-foreground text-sm">
            Loading Discord connection…
          </p>
        </CardPanel>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <CardPanel>
          <div className="text-sm">
            Discord connection could not be loaded.{" "}
            <Button onClick={refreshConnections} size="sm" variant="outline">
              Try again
            </Button>
          </div>
        </CardPanel>
      </Card>
    );
  }

  if (connections.length === 0) {
    return (
      <Frame className="w-full">
        <FrameHeader>
          <FrameTitle>Discord</FrameTitle>
          <FrameDescription>
            Collect feedback from Discord and post new requests to your
            channels.
          </FrameDescription>
        </FrameHeader>
        <FramePanel>
          <h2 className="text-sm font-semibold">Connect your server</h2>
          <p className="text-muted-foreground text-sm">
            Let your team send feedback with /feeblo, forward messages with
            “Send to Feeblo”, and post new requests to your channels.
          </p>
          <div className="mt-4">
            <Button disabled={connecting} onClick={handleConnect}>
              {connecting ? "Redirecting to Discord…" : "Connect to Discord"}
            </Button>
          </div>
        </FramePanel>
      </Frame>
    );
  }

  return (
    <div className="grid gap-4">
      {connections.map((connection) => (
        <DiscordConnectionFrame
          connection={connection}
          key={connection.id}
          onDisconnected={handleDisconnected}
          organizationId={organizationId}
        />
      ))}
    </div>
  );
}

function DiscordConnectionFrame({
  connection,
  organizationId,
  onDisconnected,
}: {
  readonly connection: DiscordConnection;
  readonly organizationId: string;
  readonly onDisconnected: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const disconnect = useAtomSet(disconnectDiscordConnectionAtom, {
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
        reactivityKeys: discordReactivityKeys(organizationId),
      });
      setDisconnecting(false);
      setDialogOpen(false);
      onDisconnected();
    } catch {
      setDisconnecting(false);
      setDialogOpen(false);
      toastManager.add({
        title: "Could not disconnect Discord",
        type: "error",
      });
    }
  };

  return (
    <Frame className="w-full">
      <FrameHeader>
        <FrameTitle>{connection.guildName}</FrameTitle>
        <FrameDescription>Discord server connected to Feeblo.</FrameDescription>
      </FrameHeader>
      <FramePanel>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Server</h2>
            <p className="text-muted-foreground text-sm">
              {connection.guildId ?? "Connecting…"}
            </p>
          </div>
          <ConnectionBadge lifecycle={connection.lifecycle} />
        </div>
        <div className="mt-4">
          <AlertDialog
            onOpenChange={(open) => {
              if (!disconnecting) {
                setDialogOpen(open);
              }
            }}
            open={dialogOpen}
          >
            <AlertDialogTrigger
              render={
                <Button className="text-destructive" variant="outline">
                  Disconnect
                </Button>
              }
            />
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect Discord?</AlertDialogTitle>
                <AlertDialogDescription>
                  Feeblo will lose access to {connection.guildName}. New post
                  notifications to your channels will stop, and your team won't
                  be able to send feedback with /feeblo until you reconnect.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="text-destructive"
                  onClick={handleDisconnect}
                >
                  {disconnecting ? "Disconnecting…" : "Disconnect"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
        </div>
      </FramePanel>
      {connection.lifecycle === "active" ? (
        <FramePanel>
          <h2 className="text-sm font-semibold">New post notifications</h2>
          <p className="text-muted-foreground text-sm">
            Post new requests to one or more text channels.
          </p>
          <div className="mt-4">
            <FeedbackChannelSelect
              connectionId={connection.id}
              organizationId={organizationId}
            />
          </div>
        </FramePanel>
      ) : null}
    </Frame>
  );
}

function ConnectionBadge({
  lifecycle,
}: {
  readonly lifecycle: DiscordConnection["lifecycle"];
}) {
  if (lifecycle === "active") {
    return (
      <span className="bg-success/10 text-success rounded-full px-2 py-0.5 text-xs font-medium">
        Connected
      </span>
    );
  }
  if (lifecycle === "connecting") {
    return (
      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
        Awaiting Discord approval
      </span>
    );
  }
  return (
    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium">
      {lifecycle}
    </span>
  );
}

function FeedbackChannelSelect({
  connectionId,
  organizationId,
}: {
  readonly connectionId: string;
  readonly organizationId: string;
}) {
  const args = { connectionId, organizationId };
  const updateNotifications = useAtomSet(
    updateDiscordChannelNotificationsAtom,
    { mode: "promise" }
  );
  const channelsResult = useAtomValue(channelsAtom(args));
  const refreshChannels = useAtomRefresh(channelsAtom(args));
  const {
    list: channels,
    isLoading,
    loadFailed,
  } = useAsyncList<DiscordChannel>(channelsResult);
  const [pendingChannelId, setPendingChannelId] = useState<string | null>(null);

  const handleToggle = async (channel: DiscordChannel, enabled: boolean) => {
    setPendingChannelId(channel.id);
    try {
      await updateNotifications({
        payload: {
          channelId: channel.id,
          connectionId,
          enabled,
          organizationId,
        },
        reactivityKeys: discordReactivityKeys(organizationId),
      });
      toastManager.add({
        title: enabled
          ? "New post notifications enabled"
          : "New post notifications disabled",
        type: "success",
      });
    } catch {
      toastManager.add({
        title: "Could not update new post notifications",
        type: "error",
      });
    } finally {
      setPendingChannelId(null);
    }
  };

  if (isLoading) {
    return <p className="text-muted-foreground text-sm">Loading channels…</p>;
  }
  if (loadFailed) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-destructive">Channels could not be loaded.</span>
        <Button onClick={refreshChannels} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    );
  }
  if (channels.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No text channels are visible to the bot yet. Make sure it has been added
        to the server, then refresh.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {channels.map((channel) => {
        const pending = pendingChannelId === channel.id;
        return (
          <div
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
            key={channel.id}
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">#{channel.name}</p>
            </div>
            <Switch
              checked={channel.notificationsEnabled}
              disabled={pending}
              onCheckedChange={(checked) => handleToggle(channel, checked)}
            />
          </div>
        );
      })}
    </div>
  );
}
