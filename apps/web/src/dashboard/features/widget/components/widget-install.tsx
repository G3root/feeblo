import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@feeblo/ui/card";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import {
  CodeIcon,
  Package01Icon,
  Robot01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import {
  buildAgentPrompt,
  buildInitSnippet,
  buildScriptSnippet,
  type WidgetEmbedConfig,
  type WidgetInstallTarget,
} from "../lib/widget-config";
import { WidgetCodeBlock } from "./widget-code-block";

interface WidgetInstallProps {
  /** Route param, used only for the Widget SSO link. */
  organizationId: string;
  config: WidgetEmbedConfig;
  target: WidgetInstallTarget;
}

/**
 * The copy-paste half of the page: the same chosen config expressed as a
 * script tag, as npm code, and as a prompt for a coding agent.
 */
export function WidgetInstall({
  config,
  organizationId,
  target,
}: WidgetInstallProps) {
  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Installation</CardFrameTitle>
        <CardFrameDescription>
          The snippets include the settings above, so they can go straight into
          the site that shows the widget.
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="px-6 pb-6">
        <Tabs defaultValue="script">
          <TabsList className="w-full">
            <TabsTab value="script">
              <HugeiconsIcon icon={CodeIcon} />
              Script
            </TabsTab>
            <TabsTab value="package">
              <HugeiconsIcon icon={Package01Icon} />
              npm
            </TabsTab>
            <TabsTab value="agent">
              <HugeiconsIcon icon={Robot01Icon} />
              Agent
            </TabsTab>
          </TabsList>
          <TabsPanel className="flex flex-col gap-3" value="script">
            <p className="text-muted-foreground text-sm">
              Paste this before the closing {"</body>"} tag of every page that
              should show the widget. No build step or npm install needed.
            </p>
            <WidgetCodeBlock
              code={buildScriptSnippet(target, config)}
              label="HTML"
            />
            <p className="text-muted-foreground text-xs">
              Reload the page and the launcher appears where you placed it. The
              organization ID is already filled in.
            </p>
          </TabsPanel>
          <TabsPanel className="flex flex-col gap-3" value="package">
            <p className="text-muted-foreground text-sm">
              For apps that bundle their JavaScript. Install the SDK with the
              project's package manager, then initialize it once on the client.
            </p>
            <WidgetCodeBlock code="pnpm add @feeblo/sdk" label="Terminal" />
            <WidgetCodeBlock
              code={buildInitSnippet(target, config)}
              label="Client entry"
            />
            <p className="text-muted-foreground text-xs">
              In React, call it in an effect in the root layout so it only runs
              in the browser. The SDK reuses an existing widget when the config
              has not changed, so a re-render is safe.
            </p>
          </TabsPanel>
          <TabsPanel className="flex flex-col gap-3" value="agent">
            <p className="text-muted-foreground text-sm">
              Copy this prompt into the coding agent in the project that should
              show the widget. It repeats the settings above, so the agent does
              not have to ask for them.
            </p>
            <WidgetCodeBlock
              code={buildAgentPrompt(target, config)}
              label="Prompt"
            />
            <p className="text-muted-foreground text-xs">
              The agent never receives a Feeblo signing secret.
            </p>
          </TabsPanel>
        </Tabs>
        <p className="text-muted-foreground mt-4 border-t pt-4 text-xs">
          Signed-in visitors are attributed to their account once{" "}
          <Link
            className="text-foreground underline underline-offset-4"
            params={{ organizationId }}
            to="/$organizationId/settings/security"
          >
            Widget SSO
          </Link>{" "}
          is configured in Security.
        </p>
      </div>
    </CardFrame>
  );
}
