import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { Suspense } from "react";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Separator } from "~/components/ui/separator";
import { SidebarTrigger } from "~/components/ui/sidebar";
import { Skeleton } from "~/components/ui/skeleton";
import { boardCollection, postCollection } from "~/lib/collections";

export type PostDetailsRouteParams = {
  boardSlug: string;
  organizationId: string;
  postSlug: string;
};

export function PostDetailsWorkspaceShell({
  children,
  params,
}: {
  children: React.ReactNode;
  params: PostDetailsRouteParams;
}) {
  return (
    <Suspense fallback={<PostDetailsWorkspaceShellSkeleton />}>
      <PostDetailsWorkspaceShellContent params={params}>
        {children}
      </PostDetailsWorkspaceShellContent>
    </Suspense>
  );
}

function PostDetailsWorkspaceShellContent({
  children,
  params,
}: {
  children: React.ReactNode;
  params: PostDetailsRouteParams;
}) {
  const { data: board } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ board: boardCollection })
        .where(({ board }) =>
          and(
            eq(board.slug, params.boardSlug),
            eq(board.organizationId, params.organizationId)
          )
        )
        .findOne();
    },
    [params.boardSlug, params.organizationId]
  );

  const { data: post } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ post: postCollection })
        .where(({ post }) =>
          and(
            eq(post.slug, params.postSlug),
            eq(post.organizationId, params.organizationId),
            eq(post.boardId, board?.id)
          )
        )
        .findOne();
    },
    [params.postSlug, params.organizationId, board?.id]
  );

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <SidebarTrigger className="-ml-1" />
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1 overflow-hidden">{children}</ScrollArea>
      </div>

      <aside className="hidden border-l bg-muted/20 px-6 py-6 lg:block">
        <h2 className="font-medium text-muted-foreground text-sm">
          Properties
        </h2>
        <div className="mt-6 space-y-4 text-sm">
          <div className="space-y-1.5">
            <p className="text-muted-foreground">Status</p>
            <p className="font-medium capitalize">
              {post?.status.replaceAll("_", " ") ?? "-"}
            </p>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-muted-foreground">Board</p>
            <p className="font-medium">{board?.name ?? "-"}</p>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-muted-foreground">Priority</p>
            <p className="text-muted-foreground">Set priority</p>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-muted-foreground">Assignee</p>
            <p className="text-muted-foreground">Assign</p>
          </div>
          <Separator />
          <div className="space-y-1.5">
            <p className="text-muted-foreground">Labels</p>
            <p className="text-muted-foreground">Add label</p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function PostDetailsWorkspaceShellSkeleton() {
  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-h-0 flex-col overflow-hidden">
        <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b">
          <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
            <Skeleton className="h-8 w-8 rounded-md" />
          </div>
        </header>

        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="p-4 md:p-6">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="mt-6 h-24 w-full" />
            <Skeleton className="mt-6 h-20 w-full rounded-xl" />
          </div>
        </ScrollArea>
      </div>

      <aside className="hidden border-l bg-muted/20 px-6 py-6 lg:block">
        <Skeleton className="h-4 w-24" />
        <div className="mt-6 space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </aside>
    </div>
  );
}
