import { Button } from "@feeblo/ui/button";
import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@feeblo/ui/card";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import type { ReactNode } from "react";

import { SettingsItem } from "~/features/settings/components/settings-item";
import { useEntitlements } from "~/hooks/use-entitlements";
import { dashboardCollections } from "~/lib/collections";

import {
  buildIdentitySnippet,
  buildSigningSnippet,
  widgetEmbedConfig,
} from "../lib/widget-config";
import { useWidgetStore } from "../lib/widget-store";
import { WidgetCodeBlock } from "./widget-code-block";
import { WidgetCopyField } from "./widget-copy-field";

interface WidgetIdentifyUsersProps {
  organizationId: string;
}

/**
 * The identity half of the page: where the signing secret lives, how the
 * customer's backend mints a token, and how that token reaches the install
 * chosen in the Installation card.
 */
export function WidgetIdentifyUsers({
  organizationId,
}: WidgetIdentifyUsersProps) {
  const store = useWidgetStore();
  const draft = useSelector(store, (snapshot) => snapshot.context.draft);
  const installTab = useSelector(
    store,
    (snapshot) => snapshot.context.installTab
  );
  const config = widgetEmbedConfig(draft);
  const target = { baseUrl: window.location.origin, organizationId };

  const { entitlements, isLoading: isEntitlementsLoading } = useEntitlements();
  const widgetSsoAvailable =
    isEntitlementsLoading || entitlements.capabilities.widgetSso;

  const { data: secrets, isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ secret: dashboardCollections.jwtSecretCollection })
        .where(({ secret }) => eq(secret.organizationId, organizationId)),
  });

  const activeSecret = (secrets ?? []).find(
    (secret) => secret.revokedAt === null
  );

  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>
          Identify your users
          {widgetSsoAvailable ? null : (
            <SettingsItem.PaidPlanIndicator
              className="ml-2 inline-block align-middle"
              content="Widget SSO requires the Starter plan or higher."
            />
          )}
        </CardFrameTitle>
        <CardFrameDescription>
          Link each signed-in user's feedback to their contact record. Your
          backend signs a short-lived identity token for each user, and Feeblo
          verifies it with your workspace signing secret.
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="flex flex-col gap-6 px-6 pb-6">
        <IdentityStep index={1} title="Get your secret">
          {isLoading ? null : activeSecret ? (
            <>
              <p className="text-muted-foreground text-sm">
                Your backend signs every identity token with this secret. Store
                it in a server-side environment variable; anyone who has it can
                mint tokens for this workspace.
              </p>
              <WidgetCopyField
                copyLabel="Copy secret"
                copyValue={activeSecret.secret}
                label="Secret"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <code className="font-mono text-xs tracking-[0.25em]">
                    {"•".repeat(32)}
                  </code>
                  <span className="text-muted-foreground text-xs">
                    Created {formatDate(activeSecret.createdAt)}
                  </span>
                </div>
              </WidgetCopyField>
            </>
          ) : (
            <>
              <p className="text-muted-foreground text-sm">
                This workspace has no signing secret yet, and identity
                verification stays off until one exists. Create one in Security,
                then copy it into your backend's environment.
              </p>
              <Button
                render={(buttonProps) => (
                  <Link
                    {...buttonProps}
                    params={{ organizationId }}
                    to="/$organizationId/settings/security"
                  />
                )}
                size="sm"
                variant="outline"
              >
                Generate a secret in Security
              </Button>
            </>
          )}
        </IdentityStep>
        <IdentityStep index={2} title="Sign the token on your backend">
          <p className="text-muted-foreground text-sm">
            Mint one token per signed-in user when their page loads, and sign it
            with HS256. Feeblo rejects a token that is missing any of these
            claims:
          </p>
          <ul className="text-muted-foreground flex list-disc flex-col gap-1 pl-4 text-sm">
            <li>
              <code>sub</code>: the user's stable ID. Feeblo matches their
              contact on this value, so it must stay the same across sessions;{" "}
              <code>email</code> and <code>name</code> are required too.
            </li>
            <li>
              <code>aud</code>: this workspace's ID. The claim pins the token to
              one workspace, so a token minted for another workspace is
              rejected.
            </li>
            <li>
              <code>iat</code> and <code>exp</code>: both required. Keep the
              lifetime to five minutes; Feeblo rejects a token that claims a
              lifetime longer than the workspace cap, 24 hours by default.
            </li>
            <li>
              <code>iss</code>: your app's URL. Feeblo stores it but does not
              verify it yet; setting it now avoids a token change when issuer
              verification ships.
            </li>
          </ul>
          <WidgetCodeBlock
            code={buildSigningSnippet(organizationId)}
            label="server.ts"
            language="ts"
          />
          <div className="flex flex-col gap-1.5">
            <h4 className="text-sm font-medium">Custom attributes</h4>
            <p className="text-muted-foreground text-sm">
              Pass contact attributes under <code>customFields</code>, and
              company attributes under <code>companies</code>, where each
              company carries its own <code>customFields</code>. Values must be
              strings, numbers, or booleans; arrays, nested objects, and keys
              that are not configured in{" "}
              <Link
                className="text-foreground underline underline-offset-4"
                params={{ organizationId }}
                to="/$organizationId/settings/custom-attributes"
              >
                Custom attributes
              </Link>{" "}
              are ignored.
            </p>
          </div>
        </IdentityStep>
        <IdentityStep index={3} title="Integrate into your install">
          <p className="text-muted-foreground text-sm">
            {installTab === "react"
              ? "Resolve the user and their token on the server, then pass both to the provider you mounted in Installation, so the widget knows who they are before they interact."
              : "Call Feeblo.identify once the SDK script has loaded, with the token your backend minted for the signed-in user. Call it again when the token is refreshed."}
          </p>
          <WidgetCodeBlock
            code={buildIdentitySnippet(target, config, installTab)}
            label={installTab === "react" ? "Provider" : "HTML"}
            language={installTab === "react" ? "tsx" : "html"}
          />
          <p className="text-muted-foreground text-xs">
            Feeblo receives the token with each submission and verifies its
            signature; your signing secret stays on your backend.
          </p>
        </IdentityStep>
      </div>
    </CardFrame>
  );
}

function IdentityStep({
  children,
  index,
  title,
}: {
  children: ReactNode;
  index: number;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium">
          {index}
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="flex flex-col gap-3 pl-[34px]">{children}</div>
    </section>
  );
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
