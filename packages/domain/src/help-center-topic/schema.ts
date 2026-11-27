import { HelpCenterTopicId, WorkspaceId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as S from "effect/Schema";

/**
 * How many sections one workspace may hold.
 *
 * A section is free — the plan counts articles — so this is an abuse bound
 * rather than a product limit. It exists because a reorder names the whole
 * list in one write: a cap on the reorder that the create did not share would
 * let a workspace reach a size it could never reorder.
 */
export const HELP_CENTER_TOPIC_LIMIT = 200;

const TopicName = S.Trim.pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(100))
);

const TopicSlug = S.Trim.pipe(
  S.check(S.isMinLength(1)),
  S.check(S.isMaxLength(100))
);

const TopicDescription = S.NullOr(S.String.pipe(S.check(S.isMaxLength(500))));

const TopicIcon = S.NullOr(S.String.pipe(S.check(S.isMaxLength(64))));

const TopicPosition = S.Int.pipe(
  S.check(S.isGreaterThanOrEqualTo(0)),
  S.check(S.isLessThanOrEqualTo(1_000_000))
);

/** A section of the help center. */
export const HelpCenterTopic = S.Struct({
  id: S.String,
  organizationId: S.String,
  slug: S.String,
  name: S.String,
  description: S.NullOr(S.String),
  icon: S.NullOr(S.String),
  position: S.Finite,
  createdAt: S.DateFromString,
  updatedAt: S.DateFromString,
});

export type THelpCenterTopic = S.Schema.Type<typeof HelpCenterTopic>;

/**
 * The dashboard's read.
 *
 * `articleCount` is a dashboard-only number: it counts every article filed
 * under the section whatever its state, which is what the section list shows.
 * The portal asks a different question — "does this section hold anything
 * published?" — and answers it by excluding empty sections outright, so its
 * read is `HelpCenterTopicPublic` and carries no count at all.
 */
export const HelpCenterTopicWithCount = S.Struct({
  ...HelpCenterTopic.fields,
  articleCount: S.Finite,
});

export type THelpCenterTopicWithCount = S.Schema.Type<
  typeof HelpCenterTopicWithCount
>;

/**
 * The portal's read: a section, with no `articleCount`.
 *
 * The number would only ever restate the listing rule — `findManyPublished`
 * already drops every section with no published article — and a count the
 * public read does not use is one more field the portal's fixtures and
 * consumers have to keep honest.
 */
export const HelpCenterTopicPublic = S.Struct({
  ...HelpCenterTopic.fields,
});

export type THelpCenterTopicPublic = S.Schema.Type<
  typeof HelpCenterTopicPublic
>;

export const HelpCenterTopicList = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type THelpCenterTopicList = S.Schema.Type<typeof HelpCenterTopicList>;

const descriptionWithDefault = TopicDescription.pipe(
  S.withDecodingDefaultKey(Effect.succeed(null))
);

const iconWithDefault = TopicIcon.pipe(
  S.withDecodingDefaultKey(Effect.succeed(null))
);

/**
 * A create names its id, like every other create in this codebase, so an
 * optimistic insert in the dashboard does not have to wait for the server.
 *
 * `slug` is optional and derived from the name when omitted: a topic slug is
 * part of a public URL, and letting it default to the name keeps a fresh
 * workspace from shipping `topic-2` because the form left a box empty.
 */
export const HelpCenterTopicCreate = S.Struct({
  id: HelpCenterTopicId.schema,
  organizationId: WorkspaceId.schema,
  name: TopicName,
  slug: S.optional(TopicSlug),
  description: descriptionWithDefault,
  icon: iconWithDefault,
  /**
   * Omitted appends to the end of the list.
   *
   * The dashboard's create dialog does not ask where a new section goes, and a
   * required position would make every create restate the current length —
   * which is a number the server can read more reliably than the client can
   * guess.
   */
  position: S.optional(TopicPosition),
});

export type THelpCenterTopicCreate = S.Schema.Type<
  typeof HelpCenterTopicCreate
>;

export const HelpCenterTopicUpdate = S.Struct({
  id: HelpCenterTopicId.schema,
  organizationId: WorkspaceId.schema,
  name: TopicName,
  slug: TopicSlug,
  description: descriptionWithDefault,
  icon: iconWithDefault,
});

export type THelpCenterTopicUpdate = S.Schema.Type<
  typeof HelpCenterTopicUpdate
>;

export const HelpCenterTopicDelete = S.Struct({
  id: HelpCenterTopicId.schema,
  organizationId: WorkspaceId.schema,
});

export type THelpCenterTopicDelete = S.Schema.Type<
  typeof HelpCenterTopicDelete
>;

/**
 * Reordering is one write for the whole list, not one per move.
 *
 * A drag that only swapped two rows would be a single call, but the dashboard
 * also offers "move to top" and multi-select moves, and a sequence of
 * per-row writes leaves the list in an order no reader ever saw if one of them
 * fails. `topicIds` is the complete order.
 */
export const HelpCenterTopicReorder = S.Struct({
  organizationId: WorkspaceId.schema,
  topicIds: S.Array(HelpCenterTopicId.schema).pipe(S.check(S.isMaxLength(200))),
});

export type THelpCenterTopicReorder = S.Schema.Type<
  typeof HelpCenterTopicReorder
>;
