import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardFrame,
  CardFrameAction,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
  CardPanel,
} from "@feeblo/ui/card";
import { CopyButton } from "@feeblo/ui/copy-button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import * as dayjs from "@feeblo/utils/dayjs";
import { MoreVerticalIcon, Plus } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { useAsyncList } from "~/hooks/use-async-list";
import { useEntitlements } from "~/hooks/use-entitlements";

import { apiKeysAtom, type ApiKey } from "../atoms";
import {
  useApiKeyCreateDialogContext,
  useApiKeyRevokeDialogContext,
} from "../dialog-stores";
import {
  ApiKeyCreateDialog,
  type CreatedApiKey,
} from "./api-key-create-dialog";
import { ApiKeyRevokeDialog } from "./api-key-revoke-dialog";

export function ApiKeysSettings({
  apiUrl,
  organizationId,
}: {
  readonly apiUrl: string;
  readonly organizationId: string;
}) {
  return (
    <ApiKeysSettingsContent apiUrl={apiUrl} organizationId={organizationId} />
  );
}

function ApiKeysSettingsContent({
  apiUrl,
  organizationId,
}: {
  readonly apiUrl: string;
  readonly organizationId: string;
}) {
  const createDialogStore = useApiKeyCreateDialogContext();
  const [oneTimeKey, setOneTimeKey] = useState<CreatedApiKey | null>(null);

  const { entitlements, isLoading: isEntitlementsLoading } = useEntitlements();
  const publicApiAvailable =
    isEntitlementsLoading || entitlements.capabilities.publicApi;

  const keysResult = useAtomValue(apiKeysAtom(organizationId));
  const refreshKeys = useAtomRefresh(apiKeysAtom(organizationId));
  const { list: keys, isLoading, loadFailed } = useAsyncList(keysResult);

  return (
    <>
      <div className="grid gap-4">
        {oneTimeKey === null ? null : (
          <OneTimeKeyPanel
            created={oneTimeKey}
            onDismiss={() => setOneTimeKey(null)}
          />
        )}

        <CardFrame>
          <CardFrameHeader>
            <CardFrameTitle>API keys</CardFrameTitle>
            <CardFrameDescription>
              Read this workspace's feedback over the versioned Public API.
              {publicApiAvailable
                ? null
                : " The Public API requires the Starter plan or higher."}
            </CardFrameDescription>
            <CardFrameAction>
              <Button
                disabled={!publicApiAvailable}
                onClick={() => createDialogStore.send({ type: "toggle" })}
                type="button"
                variant="brand"
              >
                <HugeiconsIcon icon={Plus} />
                New key
              </Button>
            </CardFrameAction>
          </CardFrameHeader>

          {isLoading ? (
            <Card>
              <CardPanel>
                <p className="text-muted-foreground text-sm">
                  Loading API keys…
                </p>
              </CardPanel>
            </Card>
          ) : null}

          {loadFailed ? (
            <Card>
              <CardPanel>
                <div className="text-sm">
                  API keys could not be loaded.{" "}
                  <Button onClick={refreshKeys} size="sm" variant="outline">
                    Try again
                  </Button>
                </div>
              </CardPanel>
            </Card>
          ) : null}

          {!(isLoading || loadFailed) && keys.length === 0 ? (
            <Card>
              <CardPanel>
                <p className="text-muted-foreground py-4 text-center text-sm">
                  No API keys yet. Create one for the integration that will read
                  your feedback.
                </p>
              </CardPanel>
            </Card>
          ) : null}

          {keys.map((key) => (
            <ApiKeyCard apiKey={key} key={key.id} />
          ))}
        </CardFrame>

        <ApiEndpointCard apiUrl={apiUrl} />
      </div>

      <ApiKeyCreateDialog onCreated={setOneTimeKey} />
      <ApiKeyRevokeDialog />
    </>
  );
}

function OneTimeKeyPanel({
  created,
  onDismiss,
}: {
  readonly created: CreatedApiKey;
  readonly onDismiss: () => void;
}) {
  return (
    <section
      aria-label="New API key"
      className="border-warning/30 bg-warning/5 rounded-xl border p-4"
    >
      <h2 className="font-medium">Copy your API key now</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        The key for {created.name} will not be shown again. Store it wherever
        the integration reads its configuration.
      </p>
      <code className="bg-background mt-3 block rounded-md border p-3 text-sm break-all">
        {created.key}
      </code>
      <div className="mt-3 flex gap-2">
        <CopyButton
          onCopy={() => created.key}
          size="sm"
          successMessage="API key copied"
          tooltipPopup="Copy API key"
        >
          Copy key
        </CopyButton>
        <Button onClick={onDismiss} size="sm" variant="outline">
          Done
        </Button>
      </div>
    </section>
  );
}

function ApiKeyCard({ apiKey }: { readonly apiKey: ApiKey }) {
  const revokeDialogStore = useApiKeyRevokeDialogContext();
  const expired = apiKey.expiresAt !== null && apiKey.expiresAt < new Date();

  return (
    <Card render={<article />}>
      <CardPanel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="grid min-w-0 gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {apiKey.name ?? "Untitled key"}
              </span>
              {apiKey.enabled ? null : (
                <Badge variant="destructive">Disabled</Badge>
              )}
              {expired ? <Badge variant="destructive">Expired</Badge> : null}
              <code className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-xs">
                {apiKey.start ?? apiKey.prefix ?? "fbk_"}…
              </code>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {apiKey.scopes.map((scope) => (
                <Badge key={scope} variant="outline">
                  {scope}
                </Badge>
              ))}
            </div>
            <p className="text-muted-foreground text-xs">
              Created {dayjs.default(apiKey.createdAt).format("MMM D, YYYY")} ·{" "}
              {apiKey.lastRequest === null
                ? "Never used"
                : `Last used ${dayjs.default(apiKey.lastRequest).fromNow()}`}
            </p>
          </div>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={`Actions for ${apiKey.name ?? "key"}`}
                  size="icon-sm"
                  variant="outline"
                >
                  <HugeiconsIcon icon={MoreVerticalIcon} />
                </Button>
              }
            />
            <MenuPopup align="end" className="w-40">
              <MenuItem
                onClick={() =>
                  revokeDialogStore.send({
                    type: "setOpen",
                    open: true,
                    data: {
                      keyId: apiKey.id,
                      keyName: apiKey.name ?? "this key",
                    },
                  })
                }
                variant="destructive"
              >
                Revoke key
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </CardPanel>
    </Card>
  );
}

/**
 * The base URL and the machine-readable contract, so an integrator can start
 * without hunting through the dashboard for them.
 */
function ApiEndpointCard({ apiUrl }: { readonly apiUrl: string }) {
  const baseUrl = `${apiUrl}/api/v1`;

  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Endpoint</CardFrameTitle>
        <CardFrameDescription>
          Send the key in the <code>x-api-key</code> header. The OpenAPI
          document describes every route, scope, and error code.
        </CardFrameDescription>
      </CardFrameHeader>
      <Card>
        <CardPanel className="grid gap-3">
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs">Base URL</span>
            <div className="flex items-center gap-2">
              <code className="bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-sm">
                {baseUrl}
              </code>
              <CopyButton
                onCopy={() => baseUrl}
                size="sm"
                successMessage="Base URL copied"
                tooltipPopup="Copy base URL"
                variant="outline"
              >
                Copy
              </CopyButton>
            </div>
          </div>
          <div className="grid gap-1">
            <span className="text-muted-foreground text-xs">OpenAPI</span>
            <a
              className="text-sm underline underline-offset-4"
              href={`${baseUrl}/openapi.json`}
              rel="noreferrer"
              target="_blank"
            >
              {baseUrl}/openapi.json
            </a>
          </div>
        </CardPanel>
      </Card>
    </CardFrame>
  );
}
