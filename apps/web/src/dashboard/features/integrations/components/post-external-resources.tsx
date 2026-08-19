import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { Link03Icon, LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import type { ReactNode } from "react";

import {
  type PostExternalResourceLink,
  postExternalResourceLinksAtom,
} from "../atoms";

/** Displays every safe external resource linked to a post and hosts optional provider actions. */
export function PostExternalResources({
  actions,
  organizationId,
  postId,
}: {
  /** Provider-owned menu items and dialogs; providers may contribute none. */
  readonly actions?: ReactNode;
  readonly organizationId: string;
  readonly postId: string;
}) {
  const resourcesResult = useAtomValue(
    postExternalResourceLinksAtom({ organizationId, postId })
  );
  const refreshResources = useAtomRefresh(
    postExternalResourceLinksAtom({ organizationId, postId })
  );
  const { resources, isLoading, loadFailed } = Result.builder(resourcesResult)
    .onInitial(() => ({
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      resources: [] as readonly PostExternalResourceLink[],
      isLoading: true,
      loadFailed: false,
    }))
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => ({
          // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
          resources: [] as readonly PostExternalResourceLink[],
          isLoading: false,
          loadFailed: true,
        }),
        onSome: ({ value }) => ({
          resources: value,
          isLoading: false,
          loadFailed: false,
        }),
      })
    )
    .onSuccess((value) => ({
      resources: value,
      isLoading: false,
      loadFailed: false,
    }))
    .exhaustive();
  return (
    <section aria-labelledby="post-external-resources-heading">
      <div className="flex items-center justify-between gap-2">
        <h2
          className="text-sm font-medium"
          id="post-external-resources-heading"
        >
          Linked resources
        </h2>
        {actions === undefined ? null : (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label="Linked resource actions"
                  className="rounded-full"
                  size="icon-xs"
                  variant="outline"
                />
              }
            >
              <HugeiconsIcon icon={Link03Icon} />
            </MenuTrigger>
            <MenuPopup align="end">{actions}</MenuPopup>
          </Menu>
        )}
      </div>
      <div className="mt-2">
        <PostExternalResourceList
          isLoading={isLoading}
          loadFailed={loadFailed}
          onRetry={refreshResources}
          resources={resources}
        />
      </div>
    </section>
  );
}

function PostExternalResourceList({
  resources,
  isLoading,
  loadFailed,
  onRetry,
}: {
  readonly resources: readonly PostExternalResourceLink[];
  readonly isLoading: boolean;
  readonly loadFailed: boolean;
  readonly onRetry: () => void;
}) {
  if (isLoading) {
    return (
      <p className="text-muted-foreground text-sm">Loading linked resources…</p>
    );
  }
  if (loadFailed) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="text-destructive">
          Could not load linked resources.
        </span>
        <Button onClick={onRetry} size="sm" variant="outline">
          Try again
        </Button>
      </div>
    );
  }
  if (resources.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No external resources linked yet.
      </p>
    );
  }
  const resourceGroups = Map.groupBy(
    resources,
    (resource) => resource.provider
  );
  return (
    <div className="grid gap-4">
      {[...resourceGroups.values()].map((providerResources) => (
        <PostExternalResourceProviderGroup
          key={providerResources[0].provider}
          resources={providerResources}
        />
      ))}
    </div>
  );
}

function PostExternalResourceProviderGroup({
  resources,
}: {
  readonly resources: readonly PostExternalResourceLink[];
}) {
  const providerDisplayName = resources[0]?.providerDisplayName ?? "External";
  return (
    <div className="grid gap-2">
      <h3 className="text-muted-foreground text-xs font-medium">
        <span className="inline-flex items-center gap-1.5">
          <HugeiconsIcon
            aria-hidden
            className="size-3.5"
            icon={LinkSquare02Icon}
          />
          {providerDisplayName}
        </span>
      </h3>
      <div className="grid gap-2">
        {resources.map((resource) => (
          <PostExternalResourceCard key={resource.id} resource={resource} />
        ))}
      </div>
    </div>
  );
}

function PostExternalResourceCard({
  resource,
}: {
  readonly resource: PostExternalResourceLink;
}) {
  const resourceLabel =
    resource.title ?? resource.displayKey ?? resource.resourceType;
  const resourceDetails = [resource.resourceType, resource.displayKey]
    .filter((value): value is string => value !== null)
    .join(" · ");
  const content = (
    <>
      <span className="min-w-0">
        <span className="block truncate">{resourceLabel}</span>
        {resourceDetails === "" ? null : (
          <span className="text-muted-foreground block truncate text-xs">
            {resourceDetails}
          </span>
        )}
      </span>
      {resource.stateKey === null ? null : (
        <span className="text-muted-foreground shrink-0 text-xs capitalize">
          {resource.stateKey}
        </span>
      )}
    </>
  );
  return (
    <a
      className="hover:bg-muted flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
      href={resource.remoteUrl.toString()}
      rel="noopener noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
}
