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
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { useState } from "react";
import {
  channelsAtom,
  connectionsAtom,
  type DiscordChannel,
  type DiscordConnection,
  discordAtomRegistry,
  discordStatusAtom,
} from "../atoms";
import {
  disconnectDiscordConnection,
  startDiscordConnect,
  updateChannelNotifications,
} from "../lib/connections";

type AsyncListState<T> = {
  readonly list: readonly T[];
  readonly isLoading: boolean;
  readonly loadFailed: boolean;
};

/** Collapses an atom AsyncResult into the loading/loaded/error trio the settings frames render. */
function useAsyncList<T>(
  result: AsyncResult.AsyncResult<readonly T[], unknown>
): AsyncListState<T> {
  return AsyncResult.match(result, {
    onInitial: () => ({ list: [], isLoading: true, loadFailed: false }),
    onFailure: ({ previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => ({ list: [], isLoading: false, loadFailed: true }),
        onSome: ({ value }) => ({
          list: value,
          isLoading: false,
          loadFailed: false,
        }),
      }),
    onSuccess: ({ value }) => ({
      list: value,
      isLoading: false,
      loadFailed: false,
    }),
  });
}

export function DiscordSettings({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  return (
    <RegistryContext.Provider value={discordAtomRegistry}>
      <DiscordSettingsContent organizationId={organizationId} />
    </RegistryContext.Provider>
  );
}

function DiscordSettingsContent({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const connectionsResult = useAtomValue(connectionsAtom(organizationId));
  const refreshConnections = useAtomRefresh(connectionsAtom(organizationId));
  const {
    list: connections,
    isLoading,
    loadFailed,
  } = useAsyncList<DiscordConnection>(connectionsResult);
  const statusResult = useAtomValue(discordStatusAtom);
  const discordConfigured = AsyncResult.match(statusResult, {
    onInitial: () => null as boolean | null,
    onFailure: () => false,
    onSuccess: ({ value }) => value,
  });

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

  const handleDisconnected = () => {
    refreshConnections();
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
          <h2 className="font-semibold text-sm">Connect your server</h2>
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

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await disconnectDiscordConnection({
        connectionId: connection.id,
        organizationId,
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
            <h2 className="font-semibold text-sm">Server</h2>
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
          <h2 className="font-semibold text-sm">New post notifications</h2>
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
      <span className="rounded-full bg-success/10 px-2 py-0.5 font-medium text-success text-xs">
        Connected
      </span>
    );
  }
  if (lifecycle === "connecting") {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
        Awaiting Discord approval
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
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
      await updateChannelNotifications({
        channelId: channel.id,
        channelName: channel.name,
        connectionId,
        enabled,
        organizationId,
      });
      refreshChannels();
      toastManager.add({
        title: enabled
          ? "New post notifications enabled"
          : "New post notifications disabled",
        type: "success",
      });
    } catch {
      refreshChannels();
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
              <p className="truncate font-medium text-sm">#{channel.name}</p>
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
