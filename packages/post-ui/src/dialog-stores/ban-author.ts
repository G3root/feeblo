import { createModalStoreContext } from "@feeblo/web-shared/xstate";

/**
 * The participation row a ban names.
 *
 * Only the server-resolved shapes are offered here: the author is read from
 * this workspace's own comment or post, never from an account id the client
 * happened to send.
 */
export type BanAuthorTarget =
  | { readonly _tag: "comment"; readonly commentId: string }
  | { readonly _tag: "post"; readonly postId: string };

/**
 * The ban confirmation for an author reached from a comment or a post.
 *
 * Data travels with the open request because the menu item closes (and
 * unmounts) before the dialog is answered: the target and the display name
 * have to survive that click.
 */
export const [BanAuthorDialogProvider, useBanAuthorDialogContext] =
  createModalStoreContext<{ authorName: string; target: BanAuthorTarget }>({
    name: "BanAuthorDialogContext",
    hookName: "useBanAuthorDialogContext",
    providerName: "BanAuthorDialogProvider",
  });
