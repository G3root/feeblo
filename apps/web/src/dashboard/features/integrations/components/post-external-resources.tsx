import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Button } from "@feeblo/ui/button";
import { Menu, MenuPopup, MenuTrigger } from "@feeblo/ui/menu";
import { LinkSquare02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { createContext, type ReactNode, useContext } from "react";
import {
  type PostExternalResourceLink,
  postExternalResourceLinksAtom,
} from "../atoms";

type PostExternalResourceActionsContextValue = {
  readonly refreshPostExternalResources: () => void;
};

const PostExternalResourceActionsContext =
  createContext<PostExternalResourceActionsContextValue | null>(null);

/** Refreshes the provider-neutral external resource list after a provider mutation. */
export function usePostExternalResourceRefresh() {
  const context = useContext(PostExternalResourceActionsContext);
  if (context === null) {
    throw new Error(
      "Post external resource refresh must be used within PostExternalResources."
    );
  }
  return context.refreshPostExternalResources;
}

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
  const refreshPostExternalResources = useAtomRefresh(
    postExternalResourceLinksAtom({ organizationId, postId })
  );
  const resources = AsyncResult.match(resourcesResult, {
    onInitial: () => null,
    onFailure: ({ previousSuccess }) =>
      Option.getOrNull(previousSuccess)?.value ?? [],
    onSuccess: ({ value }) => value,
  });
  return (
    <PostExternalResourceActionsContext.Provider
      value={{ refreshPostExternalResources }}
    >
      <section aria-labelledby="post-external-resources-heading">
        <div className="flex items-center justify-between gap-2">
          <h2
            className="font-medium text-sm"
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
                    size="icon-sm"
                    variant="outline"
                  />
                }
              >
                <HugeiconsIcon icon={LinkSquare02Icon} />
              </MenuTrigger>
              <MenuPopup align="end">{actions}</MenuPopup>
            </Menu>
          )}
        </div>
        <div className="mt-2">
          <PostExternalResourceList resources={resources} />
        </div>
      </section>
    </PostExternalResourceActionsContext.Provider>
  );
}

function PostExternalResourceList({
  resources,
}: {
  readonly resources: readonly PostExternalResourceLink[] | null;
}) {
  if (resources === null) {
    return (
      <p className="text-muted-foreground text-sm">Loading linked resources…</p>
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
      <h3 className="font-medium text-muted-foreground text-xs">
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
          <span className="block truncate text-muted-foreground text-xs">
            {resourceDetails}
          </span>
        )}
      </span>
      {resource.stateKey === null ? null : (
        <span className="shrink-0 text-muted-foreground text-xs capitalize">
          {resource.stateKey}
        </span>
      )}
    </>
  );
  return resource.remoteUrl === null ? (
    <div className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
      {content}
    </div>
  ) : (
    <a
      className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted"
      href={resource.remoteUrl.toString()}
      rel="noopener noreferrer"
      target="_blank"
    >
      {content}
    </a>
  );
}
