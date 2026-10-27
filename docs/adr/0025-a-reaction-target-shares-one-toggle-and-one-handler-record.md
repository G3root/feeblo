# ADR 0025: A reaction target shares one toggle and one handler record

## Decision

Post reactions and comment reactions are one family with two targets. `packages/domain/src/reaction/` holds what the targets agree on:

- **The failure vocabulary.** One `ReactionServiceErrors` union.
- **The pair shapes.** `ReactionList` (which post's reactions, in which workspace) and `ReactionToggleResult` (the emoji now attached, or none).
- **The handler record.** `makeReactionRpcHandlers` builds the four handlers — dashboard list, portal list, dashboard toggle, portal toggle — from one declaration, using the same `defineSurfacePair` / `definePublicEntry` composition the rest of the domain uses. Each target's `handlers.ts` is only the mapping of that record onto its own RPC method names, the way a chat provider maps `makeChatManagementRpcHandlers`.

Each target keeps what actually differs: its table and DTO, its RPC group (the names are the contract), its list queries, and the query that proves the caller may see the target. Inside each repository, `toggle` and `togglePublic` are one `toggleWith(proveVisible)`: the proof is the argument, the insert-or-delete body is written once.

## Why

After normalising the entity name, the two targets' `handlers.ts` files were the same 123 lines twice, differing in the operation names and one extra field on the toggle payload. Their `errors.ts` files were byte-identical. Their RPC groups declared the same four operations with the same payload, success, and error shapes. That is the shape ADR 0016 already treated as one family for the chat providers, and unlike the chat connection services — which ADR 0016 explicitly left unmerged at 29-52% difference — there is no per-target protocol work here to justify a second copy.

The authorization is the part that mattered. Both targets answer with the same two policies (dashboard: membership plus the post's lock; portal: restricted organization scope plus the public lock), the same rate-limit levels, the same public redaction, and the same db-error remap. Written twice, the failure mode is silent: one target gains a check the other does not, and the client's behaviour becomes target-dependent for no product reason. The two tests that pin public redaction — one per target — now exercise one implementation rather than two that happen to agree.

The toggle body was also duplicated _within_ each repository: `toggle` and `togglePublic` differ only in the query that proves visibility, so each repository carried the insert-or-delete decision twice. A change to "a second identical toggle removes it" had four places to land.

## Consequences

A third reaction target (a changelog entry, a roadmap card) is a schema, an RPC group, a repository, and a ~50-line handler binding — not a fifth copy of the policy wiring.

The factory is generic over the target's RPC tags and payload types because the RPC _names_ are the contract and cannot be derived from a prefix without making the RPC surface unsearchable. The tag type is supplied at the call site (`RpcTagsOf<typeof PostReactionRpcs>`), which is what keeps `defineSurfacePair`'s guarantees: a target that names an operation its group does not declare still fails to compile.

The repositories are deliberately _not_ merged. Their list queries differ in what "this post's reactions" means — a comment reaction joins through the comment to the post and includes comments merged away from the requested post — and a shared query generic over two Drizzle tables would need the casts this codebase forbids. Sharing the toggle is enough; the list stays each target's own.

`PostReaction` and `CommentReaction` DTOs stay separate schemas even though one is the other plus `commentId`. They are published RPC contracts with clients reading them by name, and `ReactionList` already carries the part that was genuinely identical.
