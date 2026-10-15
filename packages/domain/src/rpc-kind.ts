/**
 * Read or write, decided by an RPC's name.
 *
 * The batching client carries several reads in one HTTP request; a write
 * travels alone so a mutation never waits on, fails with, or spends the frame
 * budget of the reads a page started beside it. The transport decides per
 * frame, and only the tag travels in a frame, so the kind has to be a property
 * of the name.
 *
 * The convention is a verb prefix: every tag starts with one of the verbs
 * below, and the verb decides the kind. A read returns data and changes no
 * state (`ListPosts`, `GetPost`, `CountUnreadNotifications`); a write changes
 * state (`CreatePost`, `UpdatePostTitle`, `MarkNotificationRead`). The `Public`
 * twin of a read is a read (`ListPostsPublic`), because the prefix is what
 * carries the kind; no suffix is stripped before the prefix is matched.
 *
 * The rules are the convention, and the type checker keeps it honest:
 * `RpcKindOf` computes a tag's kind from the same lists `rpcKindOf` reads, and
 * `EveryRpcTagIsClassified` fails to compile while any tag in `AllRpcs` starts
 * with neither a read verb nor a write verb. A verb matches only at a word
 * boundary, so `CheckoutBilling` is a write even though `Check` is a read
 * verb, and `Listen` is not a `List` read.
 *
 * `RpcTagsResolved` keeps the check from passing vacuously: if `RpcTagsOf`
 * ever stopped resolving, every tag would be `never` and nothing would be
 * checked, so the alias pins one tag the union must contain.
 */
import type { AllRpcs, RpcTagsOf } from "./rpc-group";

/** The verbs a read's name starts with. A read returns data and changes nothing. */
export const readRpcVerbs = [
  "Check",
  "Count",
  "Get",
  "List",
  "Preview",
  "Resolve",
  "Search",
  "Watch",
] as const;

/** The verbs a write's name starts with. A write changes state. */
export const writeRpcVerbs = [
  "Add",
  "AdminUpdate",
  "Cancel",
  "Confirm",
  "Connect",
  "Create",
  "Delete",
  "Disconnect",
  "Hide",
  "Link",
  "Mark",
  "Merge",
  "Pause",
  "Pin",
  "Publish",
  "Remove",
  "Reorder",
  "Resume",
  "Retry",
  "Revoke",
  "Rotate",
  "Set",
  "Start",
  "Subscribe",
  "Test",
  "Toggle",
  "Unmerge",
  "Unpin",
  "Unsubscribe",
  "Update",
  "Verify",
] as const;

/** Whether a tag names a query or a mutation. */
export type RpcKind = "read" | "write";

/** The tag of every RPC in `AllRpcs`, the union the compile-time check spans. */
export type RpcTag = RpcTagsOf<typeof AllRpcs>;

type ReadVerb = (typeof readRpcVerbs)[number];
type WriteVerb = (typeof writeRpcVerbs)[number];

/**
 * `Verb` alone or followed by another capitalized word. The boundary is what
 * keeps `Check` from matching `Checkout`, and a template type cannot express
 * "end of input" inside `${Verb}${string}`, so the capitalized word is spelled
 * out.
 */
type PrefixedBy<Verb extends string> =
  | Verb
  | `${Verb}${Uppercase<string>}${string}`;

/**
 * The kind `tag` names. `never` when the name starts with neither a read verb
 * nor a write verb, which `EveryRpcTagIsClassified` turns into a compile error.
 */
export type RpcKindOf<Tag extends string> =
  Tag extends PrefixedBy<ReadVerb>
    ? "read"
    : Tag extends PrefixedBy<WriteVerb>
      ? "write"
      : never;

type AssertNever<Value extends never> = Value;
type AssertTrue<Value extends true> = Value;

/** The tags whose names start with neither a read verb nor a write verb. */
type UnclassifiedRpcTags = {
  [Tag in RpcTag]: RpcKindOf<Tag> extends never ? Tag : never;
}[RpcTag];

/** The alias that fails to compile while the tag union stops resolving. */
export type RpcTagsResolved = AssertTrue<
  "ListPosts" extends RpcTag ? true : false
>;

/** The compile-time half of the convention. */
export type EveryRpcTagIsClassified = AssertNever<UnclassifiedRpcTags>;

/**
 * Whether `tag` starts with `verb` at a word boundary: the tag equals the verb
 * or the verb is followed by a second capitalized word. The runtime twin of
 * the `PrefixedBy` template type.
 */
const isPrefixedBy = (tag: string, verb: string): boolean => {
  if (tag.length === verb.length) return tag === verb;
  if (!tag.startsWith(verb)) return false;
  const next = tag.charCodeAt(verb.length);
  return next >= 0x41 && next <= 0x5a;
};

/**
 * The runtime half of `RpcKindOf`, over the same two lists. Answers
 * `undefined` for a tag that starts with neither verb, including a tag this
 * build does not know, so the caller can send it on its own instead of
 * guessing.
 */
export const rpcKindOf = (tag: string): RpcKind | undefined => {
  if (readRpcVerbs.some((verb) => isPrefixedBy(tag, verb))) {
    return "read";
  }

  if (writeRpcVerbs.some((verb) => isPrefixedBy(tag, verb))) {
    return "write";
  }

  return undefined;
};

/** Whether an RPC names a read, and so may share one request with other reads. */
export const isReadRpc = (tag: string): boolean => rpcKindOf(tag) === "read";
