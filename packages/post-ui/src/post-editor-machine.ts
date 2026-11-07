import { setup } from "xstate";
import { z } from "zod";

/**
 * The lifecycle of one post editor's save, as an XState machine.
 *
 * Three `useState` calls held this before — the version the draft was based on,
 * a conflict flag, and a remount counter — plus a fourth derived from the
 * detail collection. The states were real: `loading` means "the row has not
 * arrived, so there is no version to save against"; `conflict` means "the server
 * moved and the user must choose"; `editing` is everything else. Nothing said
 * so, and the two choices offered at a conflict were two inline `onClick`
 * handlers that each had to remember to clear the flag, adopt the server's
 * version, and — in one case only — bump the remount counter.
 *
 * Declaring them buys three things the handlers arranged by hand:
 *
 * - **The remount is a transition, not a side effect.** "Reload latest"
 *   remounts the editor so it re-reads the server's body; "Keep my draft" does
 *   not. `reloads` is the counter the component keys the editor on, and only
 *   `RELOAD_LATEST` increments it, so the two choices can no longer be
 *   accidentally swapped.
 * - **A version cannot be adopted without leaving the conflict.** Both choices
 *   carry the version they adopt, and there is no transition out of `conflict`
 *   that does not.
 * - **`loading` is a state rather than a `=== undefined` check.** The mount
 *   effect that pins the version only applies from `loading`, so a background
 *   refresh that loads a newer row cannot move the version under a mounted
 *   draft — which is the rule the effect's `draftVersion === undefined` guard
 *   was spelling out.
 *
 * XState 6 removed `assign` and the `guard` key: a transition is a target
 * string, a `{ target, context }` patch, or a function returning one of those.
 * `SAVED` is therefore a context patch with no target — an internal transition
 * that updates the version without leaving `editing`.
 *
 * The schemas are zod rather than Effect Schema because `post-ui` does not
 * depend on `effect`: this package is bundled into the public portal, and
 * adding the Effect runtime to type three events is not a trade worth making.
 * They are type-only anyway — XState validates at runtime only when a
 * `validator` is configured.
 */

type PostEditorContext = {
  /**
   * How many times the editor has been remounted to load the server's body.
   * The component keys the editor on this, so only "reload latest" remounts.
   */
  readonly reloads: number;
  /** The version the mounted draft is based on. Undefined until the row arrives. */
  readonly version: Date | undefined;
};

// `z.union([z.date(), z.undefined()])` rather than `z.date().optional()`: XState
// wraps a schema's output in `Required<>`, so an optional key becomes a
// required `Date` and the machine could not hold "no version yet".
const MaybeDate = z.union([z.date(), z.undefined()]);

const ContextSchema = z.object({
  reloads: z.number(),
  version: MaybeDate,
});

const versionEventSchema = <TType extends string>(type: TType) =>
  z.object({ type: z.literal(type), version: z.date() });

const SavedEventSchema = z.object({
  type: z.literal("SAVED"),
  // Absent when the read-back did not yield a version: the save succeeded, so
  // the draft is no longer in conflict, but there is nothing newer to pin to.
  version: MaybeDate,
});

const ConflictEventSchema = z.object({ type: z.literal("CONFLICT") });

export const postEditorMachine = setup({
  schemas: {
    context: ContextSchema,
    events: {
      CONFLICT: ConflictEventSchema,
      KEEP_DRAFT: versionEventSchema("KEEP_DRAFT"),
      RELOAD_LATEST: versionEventSchema("RELOAD_LATEST"),
      SAVED: SavedEventSchema,
      VERSION_AVAILABLE: versionEventSchema("VERSION_AVAILABLE"),
    },
  },
}).createMachine({
  context: { reloads: 0, version: undefined },
  id: "postEditor",
  initial: "loading",
  states: {
    // The detail collection has not produced the row yet. `VERSION_AVAILABLE`
    // is the only way out, so a draft cannot be mounted without a version.
    loading: {
      on: {
        VERSION_AVAILABLE: {
          context: ({ event }: { event: { version: Date } }) => ({
            version: event.version,
          }),
          target: "editing",
        },
      },
    },
    editing: {
      on: {
        // An internal transition: the save succeeded and the row's version
        // moved, which is a context update, not a change of state.
        SAVED: {
          context: ({
            context,
            event,
          }: {
            context: PostEditorContext;
            event: { version?: Date };
          }) => ({ version: event.version ?? context.version }),
        },
        CONFLICT: { target: "conflict" },
      },
    },
    // The save was rejected because the server moved. The editor cannot submit
    // again from here; the user has to say which copy wins.
    conflict: {
      on: {
        // Keep the mounted draft, adopt the server's version, and save over it
        // on the next submit.
        KEEP_DRAFT: {
          context: ({ event }: { event: { version: Date } }) => ({
            version: event.version,
          }),
          target: "editing",
        },
        // Throw the draft away and re-read the server's body.
        RELOAD_LATEST: {
          context: ({
            context,
            event,
          }: {
            context: PostEditorContext;
            event: { version: Date };
          }) => ({
            reloads: context.reloads + 1,
            version: event.version,
          }),
          target: "editing",
        },
      },
    },
  },
});

/**
 * The two fields of a running actor's snapshot this module reads. Structural
 * rather than `SnapshotFrom<…>` because `@xstate/react` widens the snapshot's
 * `status` for its own subscribe helpers.
 */
export type PostEditorSnapshot = {
  readonly context: PostEditorContext;
  readonly matches: (state: string) => boolean;
};

export type PostEditorStatus = "loading" | "editing" | "conflict";

export type PostEditorState = {
  /** Changes only on "reload latest"; the component uses it as the editor's key. */
  readonly editorKey: number;
  readonly status: PostEditorStatus;
  /** The version to send as `expectedUpdatedAt`, or undefined while loading. */
  readonly version: Date | undefined;
};

export const toPostEditorState = (
  snapshot: PostEditorSnapshot
): PostEditorState => ({
  editorKey: snapshot.context.reloads,
  status: snapshot.matches("conflict")
    ? "conflict"
    : snapshot.matches("editing")
      ? "editing"
      : "loading",
  version: snapshot.context.version,
});
