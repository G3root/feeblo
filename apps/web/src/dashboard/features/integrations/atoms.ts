import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";

import { loadPostExternalResourceLinks } from "./lib/post-external-resources";

/** Safe, provider-neutral external resource link returned for a feedback post. */
export type PostExternalResourceLink = Awaited<
  ReturnType<typeof loadPostExternalResourceLinks>
>[number];

/** Identifies one post whose external resource links should be cached. */
export type PostExternalResourceLinkArgs = {
  readonly organizationId: string;
  readonly postId: string;
};

/** Cached provider-neutral external resource links for one feedback post. */
export const postExternalResourceLinksAtom = Atom.family(
  (args: PostExternalResourceLinkArgs) =>
    Atom.make(
      Effect.tryPromise(() => loadPostExternalResourceLinks(args))
    ).pipe(
      Atom.swr({
        staleTime: "15 seconds",
        revalidateOnFocus: "always",
        focusSignal: Atom.windowFocusSignal,
      }),
      Atom.setIdleTTL("5 minutes")
    )
);
