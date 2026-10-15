/**
 * Read or write, decided by an RPC's name.
 *
 * The batching client carries several reads in one HTTP request; a write
 * travels alone so a mutation never waits on, fails with, or spends the frame
 * budget of the reads a page started beside it. The transport decides per
 * frame, and only the tag travels in a frame, so the kind has to be a property
 * of the name.
 *
 * The rules below are the convention, and the type checker keeps it honest:
 * `RpcKindOf` computes a tag's kind from the same lists `rpcKindOf` reads, and
 * `EveryRpcTagIsClassified` fails to compile while any tag in `AllRpcs`
 * matches neither list. An RPC is a read when its name ends with the noun it
 * returns (`PostList`, `PostGet`), with its `Public` twin read against the same
 * name so `PostGetPublic` is a read like `PostGet`. An RPC is a write when its
 * name carries the verb it performs, which may sit anywhere in the tag because
 * several operations qualify it (`OrganizationUpdateMemberRole`,
 * `PostUpdateTitle`).
 *
 * The read test runs first, and that order is part of the convention:
 * `PostDeleteEligibilityList` and `PostStatusDeletePreview` are reads even
 * though a write verb appears in their names, because the verb is part of the
 * noun they return. A tag matching neither list is a compile error, and the
 * runtime classifier answers "no kind" for it, so an unknown frame is sent on
 * its own rather than sharing a request with a write.
 */
import type { AllRpcs, RpcTagsOf } from "./rpc-group";

/** The suffixes a read's name ends with, after its `Public` twin is dropped. */
export const readRpcSuffixes = [
  "List",
  "Get",
  "Watch",
  "Search",
  "Suggestions",
  "Count",
  "History",
  "Status",
  "Check",
  "Preview",
  "Eligibility",
  "ResolveMerged",
  "Links",
] as const;

/**
 * The verbs a write's name carries. The list names the write vocabulary, not
 * only the verbs in use today, so a new mutation that follows it needs no
 * change here.
 */
export const writeRpcVerbs = [
  "Add",
  "AdminUpdate",
  "Archive",
  "Cancel",
  "Checkout",
  "Confirm",
  "Connect",
  "Create",
  "Delete",
  "Delivery",
  "Disconnect",
  "HidePoweredByBranding",
  "Link",
  "MakeDefault",
  "MarkAllRead",
  "MarkRead",
  "Merge",
  "OnBehalf",
  "Pause",
  "Pin",
  "Portal",
  "Publish",
  "Remove",
  "Rename",
  "Reorder",
  "Resume",
  "Retry",
  "Revoke",
  "Rotate",
  "Send",
  "Set",
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

/** A read's or write's public twin classified by the name its `Public` suffix hides. */
type WithoutPublic<Tag extends string> = Tag extends `${infer Base}Public`
  ? Base
  : Tag;

type ReadSuffix = (typeof readRpcSuffixes)[number];
type WriteVerb = (typeof writeRpcVerbs)[number];

/**
 * The kind `tag` names. `never` when the name carries neither a read suffix
 * nor a write verb, which `EveryRpcTagIsClassified` turns into a compile error.
 */
export type RpcKindOf<Tag extends string> =
  WithoutPublic<Tag> extends `${string}${ReadSuffix}`
    ? "read"
    : WithoutPublic<Tag> extends `${string}${WriteVerb}${string}`
      ? "write"
      : never;

type AssertNever<Value extends never> = Value;
type AssertTrue<Value extends true> = Value;

/** The tags whose names carry neither a read suffix nor a write verb. */
type UnclassifiedRpcTags = {
  [Tag in RpcTag]: RpcKindOf<Tag> extends never ? Tag : never;
}[RpcTag];

/**
 * The compile-time half of the convention, and the whole of its enforcement:
 * the aliases below do not typecheck while a tag in `AllRpcs` is unclassified.
 *
 * `RpcTagsResolved` is the guard that keeps this from passing vacuously: if
 * `RpcTagsOf<typeof AllRpcs>` ever stopped resolving, `RpcTag` would be `never`
 * and every mapped check over it would succeed without reading a single tag.
 */
export type RpcTagsResolved = AssertTrue<
  "PostList" extends RpcTag ? true : false
>;

export type EveryRpcTagIsClassified = AssertNever<UnclassifiedRpcTags>;

/**
 * The runtime half of `RpcKindOf`, over the same two lists. Answers
 * `undefined` for a tag that matches neither, including a tag this build does
 * not know, so the caller can send it on its own instead of guessing.
 */
export const rpcKindOf = (tag: string): RpcKind | undefined => {
  const bare = tag.endsWith("Public") ? tag.slice(0, -"Public".length) : tag;

  if (readRpcSuffixes.some((suffix) => bare.endsWith(suffix))) {
    return "read";
  }

  if (writeRpcVerbs.some((verb) => bare.includes(verb))) {
    return "write";
  }

  return undefined;
};

/** Whether an RPC names a read, and so may share one request with other reads. */
export const isReadRpc = (tag: string): boolean => rpcKindOf(tag) === "read";
