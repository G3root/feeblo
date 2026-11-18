import { useAtomValue } from "@effect/atom-react";
import type { TDataImportProviderDescriptor } from "@feeblo/domain/data-transfer/provider-schema";
import type { TDataImportJobSummary } from "@feeblo/domain/data-transfer/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import {
  DashboardSquare01Icon,
  FileSpreadsheetIcon,
  MessageDone01Icon,
  MessageMultiple01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type HugeiconsIconProps } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as Result from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";

import { dataImportProvidersAtom } from "../atoms";
import { CsvImportDialog, ProviderImportDialog } from "./import-source-dialogs";

/** One source's look, keyed by the catalog id. */
const PROVIDER_ICONS = {
  canny: MessageDone01Icon,
  nolt: MessageMultiple01Icon,
  productboard: DashboardSquare01Icon,
} satisfies Record<
  TDataImportProviderDescriptor["id"],
  HugeiconsIconProps["icon"]
>;

const PROVIDER_ICON_TONES = {
  canny: "text-sky-600 dark:text-sky-400",
  nolt: "text-violet-600 dark:text-violet-400",
  productboard: "text-orange-600 dark:text-orange-400",
} satisfies Record<TDataImportProviderDescriptor["id"], string>;

/** The providers this deployment offers; empty until the first catalog read. */
function useImportProviders(organizationId: string): {
  readonly failed: boolean;
  readonly providers: readonly TDataImportProviderDescriptor[];
} {
  const result = useAtomValue(dataImportProvidersAtom(organizationId));

  return Result.builder(result)
    .onInitial(
      // SAFETY: Empty-state placeholder: no cards is valid until the catalog resolves.
      () => ({
        failed: false,
        providers: [] as readonly TDataImportProviderDescriptor[],
      })
    )
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        // SAFETY: Empty-state placeholder: no cards is valid until the catalog resolves.
        onNone: () => ({
          failed: true,
          providers: [] as readonly TDataImportProviderDescriptor[],
        }),
        onSome: ({ value }) => ({ failed: false, providers: value }),
      })
    )
    .onSuccess((value) => ({ failed: false, providers: value }))
    .exhaustive();
}

/**
 * One import source. The card is the same for a file and for a provider; the
 * caller supplies the icon and the action, and the chips are what the source
 * can actually carry.
 */
function ImportSourceCard({
  actionLabel,
  chips,
  description,
  disabled = false,
  icon,
  iconClassName,
  onAction,
  title,
}: {
  readonly actionLabel: string;
  readonly chips: readonly string[];
  readonly description: string;
  readonly disabled?: boolean;
  readonly icon: HugeiconsIconProps["icon"];
  readonly iconClassName?: string;
  readonly onAction: () => void;
  readonly title: string;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader>
        <span className="flex items-center gap-2">
          <span className="bg-muted/60 flex size-8 items-center justify-center rounded-lg border">
            <HugeiconsIcon
              className={iconClassName ?? "text-muted-foreground size-4"}
              icon={icon}
            />
          </span>
          <CardTitle>{title}</CardTitle>
        </span>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-1 flex-col gap-3">
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <Badge key={chip} variant="outline">
              {chip}
            </Badge>
          ))}
        </div>
      </CardPanel>
      <CardFooter>
        <Button
          disabled={disabled}
          onClick={onAction}
          type="button"
          variant="outline"
        >
          {actionLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * The import sources: a file, or a product this workspace is moving away
 * from. The provider cards come from the server catalog, so a new adapter
 * appears here without a web release; the CSV card is local because the file
 * transfer route is part of this app.
 */
export function ImportSourcesSection({
  disabled = false,
  onStaged,
  organizationId,
}: {
  readonly disabled?: boolean;
  readonly onStaged: (job: TDataImportJobSummary) => void;
  readonly organizationId: string;
}) {
  const { failed, providers } = useImportProviders(organizationId);
  const [csvOpen, setCsvOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const [openProvider, setOpenProvider] =
    useState<TDataImportProviderDescriptor | null>(null);

  // A submission holds this lock until it settles, not until its dialog
  // closes: the mutation atom is shared, so a second start while the first is
  // in flight could receive the first request's result.
  const sourcesDisabled = disabled || isStarting;

  return (
    <>
      {disabled ? (
        <p className="text-muted-foreground text-xs">
          {m.data_import_sources_busy_hint()}
        </p>
      ) : null}
      {isStarting ? (
        <p className="text-muted-foreground text-xs">
          {m.data_import_sources_starting_hint()}
        </p>
      ) : null}
      {failed ? (
        <p className="text-destructive text-xs">
          {m.data_import_sources_load_failed()}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ImportSourceCard
          actionLabel={m.data_import_csv_action()}
          chips={[
            m.data_import_csv_chip_content(),
            m.data_import_csv_chip_routing(),
            m.data_import_csv_chip_author(),
          ]}
          description={m.data_import_csv_card_description()}
          disabled={sourcesDisabled}
          icon={FileSpreadsheetIcon}
          onAction={() => setCsvOpen(true)}
          title={m.data_import_csv_card_title()}
        />
        {providers.map((provider) => (
          <ImportSourceCard
            actionLabel={m.data_import_provider_action({
              provider: provider.name,
            })}
            chips={provider.carries}
            description={provider.tagline}
            disabled={sourcesDisabled}
            icon={PROVIDER_ICONS[provider.id]}
            iconClassName={`size-4 ${PROVIDER_ICON_TONES[provider.id]}`}
            key={provider.id}
            onAction={() => setOpenProvider(provider)}
            title={provider.name}
          />
        ))}
      </div>

      {csvOpen ? (
        <CsvImportDialog
          key={organizationId}
          onOpenChange={setCsvOpen}
          onStaged={onStaged}
          onStartingChange={setIsStarting}
          open
          organizationId={organizationId}
        />
      ) : null}
      {openProvider === null ? null : (
        <ProviderImportDialog
          key={organizationId}
          onOpenChange={(open) => {
            if (!open) {
              setOpenProvider(null);
            }
          }}
          onStaged={onStaged}
          onStartingChange={setIsStarting}
          open
          organizationId={organizationId}
          provider={openProvider}
        />
      )}
    </>
  );
}
