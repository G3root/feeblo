import {
  CardFrame,
  CardFrameDescription,
  CardFrameHeader,
  CardFrameTitle,
} from "@feeblo/ui/card";
import { CopyButton } from "@feeblo/ui/copy-button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "@feeblo/ui/tabs";
import { CodeXmlIcon, ReactIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";

import {
  buildAgentPrompt,
  buildReactSnippet,
  buildScriptSnippet,
  isWidgetInstallTab,
  widgetEmbedConfig,
  type WidgetEmbedConfig,
  type WidgetInstallTab,
  type WidgetInstallTarget,
} from "../lib/widget-config";
import { useWidgetStore } from "../lib/widget-store";
import { WidgetCodeBlock } from "./widget-code-block";

interface WidgetInstallProps {
  /** Route param, folded into the snippets as the workspace id. */
  organizationId: string;
}

/**
 * The copy-paste half of the page: the same chosen config expressed as a
 * script tag or a React provider, plus a prompt for a coding agent.
 */
export function WidgetInstall({ organizationId }: WidgetInstallProps) {
  const store = useWidgetStore();
  const draft = useSelector(store, (snapshot) => snapshot.context.draft);
  const installTab = useSelector(
    store,
    (snapshot) => snapshot.context.installTab
  );
  const config = widgetEmbedConfig(draft);
  // The dashboard and the widget iframe are served by the same deployment, so
  // the page's own origin is the host the snippet should point at.
  const target = { baseUrl: window.location.origin, organizationId };

  return (
    <CardFrame>
      <CardFrameHeader>
        <CardFrameTitle>Installation</CardFrameTitle>
        <CardFrameDescription>
          Pick how your site embeds the widget. The snippets already include the
          settings from above, so you can paste them as they are.
        </CardFrameDescription>
      </CardFrameHeader>
      <div className="px-6 pb-6">
        <Tabs
          onValueChange={(value: string) => {
            if (isWidgetInstallTab(value)) {
              store.send({ type: "setInstallTab", tab: value });
            }
          }}
          value={installTab}
        >
          <TabsList className="w-full">
            <TabsTab value="vanilla">
              <HugeiconsIcon icon={CodeXmlIcon} />
              Vanilla
            </TabsTab>
            <TabsTab value="react">
              <HugeiconsIcon icon={ReactIcon} />
              React
            </TabsTab>
          </TabsList>
          <TabsPanel className="flex flex-col gap-3" value="vanilla">
            <p className="text-muted-foreground text-sm">
              Paste this before the closing {"</body>"} tag of every page that
              should show the widget. The script loads from unpkg and
              initializes the widget on its own, so there is nothing to build or
              install.
            </p>
            <WidgetCodeBlock
              code={buildScriptSnippet(target, config)}
              label="HTML"
              language="html"
            />
            <p className="text-muted-foreground text-xs">
              {config.placement === undefined
                ? "Reload the page, then call Feeblo.open() from your own button. The organization ID, modules, and theme are already filled in."
                : "Reload the page and the launcher appears in the corner you chose. The organization ID, modules, and theme are already filled in."}
            </p>
            <InstallPromptButton
              config={config}
              tab="vanilla"
              target={target}
            />
          </TabsPanel>
          <TabsPanel className="flex flex-col gap-3" value="react">
            <p className="text-muted-foreground text-sm">
              For React apps that bundle their JavaScript (React 19 or newer).
              Mount the provider once near the root; it initializes the SDK and
              mounts the widget once for the whole app.
            </p>
            <WidgetCodeBlock
              code="pnpm add @feeblo/sdk-react @feeblo/sdk"
              label="Terminal"
              language="bash"
            />
            <WidgetCodeBlock
              code={buildReactSnippet(target, config)}
              label="Root layout"
              language="tsx"
            />
            <p className="text-muted-foreground text-xs">
              The SDK keeps one widget per page. Mount one provider and skip the
              script tag; loading both makes the two embeds compete for the same
              container.
            </p>
            <InstallPromptButton config={config} tab="react" target={target} />
          </TabsPanel>
        </Tabs>
      </div>
    </CardFrame>
  );
}

interface InstallPromptButtonProps {
  config: WidgetEmbedConfig;
  tab: WidgetInstallTab;
  target: WidgetInstallTarget;
}

function InstallPromptButton({
  config,
  tab,
  target,
}: InstallPromptButtonProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
      <p className="text-muted-foreground text-xs">
        Let a coding agent handle the install? The prompt repeats these settings
        so it does not have to ask.
      </p>
      <CopyButton
        onCopy={() => buildAgentPrompt(target, config, tab)}
        size="sm"
        successMessage="Installation prompt copied"
        tooltipPopup="Copy installation as prompt"
        variant="outline"
      >
        Copy installation as prompt
      </CopyButton>
    </div>
  );
}
