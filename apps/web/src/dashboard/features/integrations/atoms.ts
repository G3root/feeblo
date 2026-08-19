import * as Atom from "effect/unstable/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

export type PostExternalResourceLink = Atom.Success<
  ReturnType<typeof postExternalResourceLinksAtom>
>[number];

export type PostExternalResourceLinkArgs = {
  readonly organizationId: string;
  readonly postId: string;
};

export const postExternalResourceLinksAtom = Atom.family(
  (args: PostExternalResourceLinkArgs) =>
    DashboardClient.query("PostExternalResourceLinkList", args, {
      reactivityKeys: { postExternalResources: [args.postId] },
    }).pipe(dashboardSWR("15 seconds"), Atom.setIdleTTL("5 minutes"))
);
