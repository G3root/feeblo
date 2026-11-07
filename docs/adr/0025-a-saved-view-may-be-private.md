# ADR 0025: A saved view may be private or shared with the workspace

## Decision

`saved_view` gains an `is_private` column. A view is visible to its owner, and to every other member of the workspace when it is not private. Visibility changes what `ListSavedViews` returns; it does not change ownership. Update, delete, and reorder remain scoped to the session's member, so a shared view can be opened by a colleague but only its owner can change or remove it.

The create and update payloads carry `isPrivate`. Omitting it is allowed for clients that predate sharing: create treats omission as private, and update keeps the row's current value. The column defaults to `true`, so rows saved before this decision stay private instead of being published by the migration.

The tab strip renders owned views first and shared views after them. Only owned pills are drag sources, and `ReorderSavedViews` is validated against the member's owned list, not the visible list. A member may move their own tabs without moving somebody else's.

## Why

ADR 0024 deliberately kept saved views personal and left a visibility column for later. The later feature needs exactly that column, and making private the opt-in is the useful direction: a saved view is a result set worth pointing a colleague at, while "only me" is the exception. Existing rows are the one group whose expectation predates the feature, so they are migrated as private.

Sharing is not editing. Keeping the write predicates on `member_id` preserves the single-authorization-predicate property from ADR 0024 even when a row is visible to the whole workspace.

## Consequences

- A private view's id answers the same "not available" state as a deleted view or one belonging to another member, so the route cannot be used to probe for ids.
- The dashboard's saved-view collection now contains rows owned by other members. The pill menu hides edit and delete for those rows and the drag sensor ignores them.
- Duplicating a shared view creates a row owned by the duplicating member, with the source view's visibility copied.
- `is_private` is not part of `query`; it describes who may read the view, not what the view selects.
