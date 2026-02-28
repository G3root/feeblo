import { A, useParams } from "@solidjs/router";
import { and, eq, useLiveQuery } from "@tanstack/solid-db";
import { ArrowLeftIcon, StarIcon } from "lucide-solid";
import { ErrorBoundary, Match, Show, Suspense, Switch } from "solid-js";
import { postCollection } from "src/lib/collection";
import { useSite } from "src/providers/site-provider";
import { CommentsSection } from "../components/comments/comments-section";
import { Button, buttonVariants } from "../components/ui/button";
import { Separator } from "../components/ui/separator";

export function PostPage() {
  const params = useParams<{ slug: string }>();
  const site = useSite();

  const post = useLiveQuery((q) =>
    q
      .from({ post: postCollection })
      .where(({ post }) =>
        and(
          eq(post.slug, params.slug),
          eq(post.organizationId, site.organizationId)
        )
      )
  );

  const postId = () => post()?.[0]?.id;

  return (
    <div class="mx-auto max-w-7xl px-6 py-8">
      <div class="grid grid-cols-12 gap-6">
        <div class="col-span-8">
          <div class="flex flex-col">
            <A
              class={buttonVariants({ variant: "ghost", size: "icon" })}
              href="/"
            >
              <ArrowLeftIcon />
            </A>

            <ErrorBoundary fallback={<div>Error</div>}>
              <Suspense fallback={<div>Loading...</div>}>
                <Switch>
                  <Match when={post()}>
                    <div class="flex items-start gap-2">
                      <div>
                        <Button size="icon" variant="ghost">
                          <StarIcon />
                        </Button>
                      </div>
                      <div class="flex flex-1 flex-col gap-4">
                        <h1 class="flex items-center gap-2 font-semibold text-xl">
                          <span>⚠️</span>
                          <span>{post()?.[0]?.title}</span>
                        </h1>

                        <div
                          class="prose prose-sm"
                          textContent={post()?.[0]?.content}
                        />

                        <div>
                          <Separator />
                        </div>

                        <Show when={postId()}>
                          <div class="pt-4">
                            <CommentsSection postId={postId() as string} />
                          </div>
                        </Show>
                      </div>
                    </div>
                  </Match>
                </Switch>
              </Suspense>
            </ErrorBoundary>

            {/* <Switch>
              <Match when={query.isError}>
                <div>Error</div>
              </Match>
              <Match when={query.isLoading}>
                <div>Loading...</div>
              </Match>
              <Match when={query.data}>
           
              </Match>
            </Switch> */}
          </div>
        </div>
        <div class="col-span-4">
          <div class="flex items-center justify-between">
            <h1 class="font-bold text-2xl">Post Detail</h1>
          </div>
        </div>
      </div>
    </div>
  );
}
