import { fetchRpc } from "~/lib/runtime";

/** Lists safe external resources linked to one feedback post across providers. */
export const loadPostExternalResourceLinks = (input: {
  readonly organizationId: string;
  readonly postId: string;
}) =>
  fetchRpc((rpc) => rpc.PostExternalResourceLinkList(input)).then((result) => [
    ...result,
  ]);
