import { Button } from "@feeblo/ui/button";
import {
  Menu,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@feeblo/ui/menu";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { FilterIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { createContext, use, useMemo } from "react";

// ---------------------------------------------------------------------------
// Shareable roadmap layout primitives — compound components with lifted state
// Follows vercel-composition-patterns: avoid boolean props, use compound
// components, lift state into provider, decouple implementation via generic
// context interface (state/actions/meta), prefer children over render props.
// ---------------------------------------------------------------------------

export type RoadmapSwitcherOption = {
  id: string;
  name: string;
  slug: string;
};

// --- Generic context interface (state / actions / meta) ---

interface RoadmapState {
  description: string | null | undefined;
  options: RoadmapSwitcherOption[];
  title: string;
  value: string;
}

interface RoadmapActions {
  onValueChange: (slug: string) => void;
}

interface RoadmapMeta {
  // reserved for refs / capabilities; currently empty but keeps interface extensible
}

interface RoadmapContextValue {
  actions: RoadmapActions;
  meta: RoadmapMeta;
  state: RoadmapState;
}

const RoadmapContext = createContext<RoadmapContextValue | null>(null);

function useRoadmapContext() {
  const ctx = use(RoadmapContext);
  if (!ctx) {
    throw new Error("Roadmap components must be used within Roadmap.Provider");
  }
  return ctx;
}

// --- Provider — the only place that knows how state is bridged ---

type RoadmapProviderProps = {
  children: React.ReactNode;
  description?: string | null;
  onValueChange: (slug: string) => void;
  options: RoadmapSwitcherOption[];
  title: string;
  value: string;
};

function RoadmapProvider({
  children,
  description,
  onValueChange,
  options,
  title,
  value,
}: RoadmapProviderProps) {
  const contextValue = useMemo<RoadmapContextValue>(
    () => ({
      actions: { onValueChange },
      meta: {},
      state: { description, options, title, value },
    }),
    [onValueChange, description, options, title, value]
  );

  return (
    <RoadmapContext.Provider value={contextValue}>
      {children}
    </RoadmapContext.Provider>
  );
}

// --- Compound layout primitives (no boolean props, compose via children) ---

export function RoadmapPageContainer({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {children}
    </div>
  );
}

export function RoadmapPageSection({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full min-h-0 shrink-0 flex-col gap-4">
      {children}
    </section>
  );
}

function RoadmapHeader({ children }: { children: React.ReactNode }) {
  return (
    <header className="flex flex-row items-start justify-between gap-2 px-3 sm:gap-4">
      {children}
    </header>
  );
}

function RoadmapHeaderMain({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0 flex-1">{children}</div>;
}

function RoadmapTitle({ children }: { children?: React.ReactNode }) {
  const {
    state: { title },
  } = useRoadmapContext();
  return <h1 className="text-xl font-semibold">{children ?? title}</h1>;
}

function RoadmapDescription({ children }: { children?: React.ReactNode }) {
  const {
    state: { description },
  } = useRoadmapContext();
  const content = children ?? description;
  if (!content) return null;
  return <p className="text-muted-foreground mt-1 text-sm">{content}</p>;
}

function RoadmapHeaderActions({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
      {children}
    </div>
  );
}

type RoadmapSwitcherViewProps = {
  onValueChange: (slug: string) => void;
  options: RoadmapSwitcherOption[];
  value: string;
};

// Single source of truth for the switcher UI (desktop Select + mobile Menu).
function RoadmapSwitcherView({
  onValueChange,
  options,
  value,
}: RoadmapSwitcherViewProps) {
  return (
    <>
      {/* Desktop: Select */}
      <div className="hidden sm:block">
        <Select
          onValueChange={(nextSlug) => {
            if (nextSlug !== null && nextSlug !== value) {
              onValueChange(nextSlug);
            }
          }}
          value={value}
        >
          <SelectTrigger className="w-44 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {options.map((roadmap) => (
              <SelectItem key={roadmap.id} value={roadmap.slug}>
                {roadmap.name}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>

      {/* Mobile: Menu like changelog filter */}
      <div className="sm:hidden">
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={`Switch roadmap, current ${options.find((o) => o.slug === value)?.name ?? value}`}
                size="icon-sm"
                variant="outline"
              >
                <HugeiconsIcon icon={FilterIcon} />
              </Button>
            }
          />
          <MenuPopup align="end" className="w-56">
            <MenuRadioGroup
              value={value}
              onValueChange={(next) => {
                if (next && next !== value) onValueChange(next);
              }}
            >
              {options.map((roadmap) => (
                <MenuRadioItem key={roadmap.id} value={roadmap.slug}>
                  {roadmap.name}
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
    </>
  );
}

function RoadmapSwitcher() {
  const {
    actions: { onValueChange },
    state: { options, value },
  } = useRoadmapContext();

  if (options.length === 0) return null;

  return (
    <RoadmapSwitcherView
      onValueChange={onValueChange}
      options={options}
      value={value}
    />
  );
}

// --- Shared empty / skeleton (no boolean, explicit variants) ---

export function RoadmapNoColumnsEmpty() {
  return (
    <div className="border-border/70 bg-muted/20 text-muted-foreground flex min-h-64 flex-1 items-center justify-center rounded-lg border border-dashed p-6 text-center text-sm">
      This roadmap has no columns configured.
    </div>
  );
}

export function RoadmapSkeleton() {
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col overflow-hidden p-4 md:p-6">
      <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 overflow-x-auto p-3">
        {["planned", "in-progress", "completed"].map((key) => (
          <div className="bg-muted/30 h-96 w-80 rounded-lg" key={key} />
        ))}
      </div>
    </div>
  );
}

// --- Back-compat wrappers (avoid breaking existing callers) ---

// Old prop-based header kept for back-compat; delegates to compound composition
type LegacyRoadmapPageHeaderProps = {
  actions?: React.ReactNode;
  description?: string | null;
  onSwitchRoadmap?: (slug: string) => void;
  switcherOptions?: RoadmapSwitcherOption[];
  switcherValue?: string;
  title: string;
};

export function RoadmapPageHeader({
  actions,
  description,
  onSwitchRoadmap,
  switcherOptions,
  switcherValue,
  title,
}: LegacyRoadmapPageHeaderProps) {
  const hasSwitcher =
    onSwitchRoadmap !== undefined &&
    switcherOptions !== undefined &&
    switcherOptions.length > 0 &&
    switcherValue !== undefined;

  // If caller uses legacy props, compose via new compound internally
  if (hasSwitcher) {
    return (
      <RoadmapProvider
        description={description}
        onValueChange={onSwitchRoadmap}
        options={switcherOptions}
        title={title}
        value={switcherValue}
      >
        <RoadmapHeader>
          <RoadmapHeaderMain>
            <RoadmapTitle />
            <RoadmapDescription />
          </RoadmapHeaderMain>
          <RoadmapHeaderActions>
            <RoadmapSwitcher />
            {actions}
          </RoadmapHeaderActions>
        </RoadmapHeader>
      </RoadmapProvider>
    );
  }

  return (
    <RoadmapHeader>
      <RoadmapHeaderMain>
        <h1 className="text-xl font-semibold">{title}</h1>
        {description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </RoadmapHeaderMain>
      {actions ? <RoadmapHeaderActions>{actions}</RoadmapHeaderActions> : null}
    </RoadmapHeader>
  );
}

// --- Compound export (preferred API) ---

export const Roadmap = {
  Container: RoadmapPageContainer,
  Context: RoadmapContext,
  Description: RoadmapDescription,
  Header: RoadmapHeader,
  HeaderActions: RoadmapHeaderActions,
  HeaderMain: RoadmapHeaderMain,
  NoColumnsEmpty: RoadmapNoColumnsEmpty,
  Provider: RoadmapProvider,
  Section: RoadmapPageSection,
  Skeleton: RoadmapSkeleton,
  Switcher: RoadmapSwitcher,
  Title: RoadmapTitle,
  useContext: useRoadmapContext,
};
