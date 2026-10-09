# ADR 0016: A chat provider is one provider family

## Decision

Slack and Discord are one provider family — a **chat provider** — and share one implementation module, `packages/domain/src/integration/chat/`, for everything that does not depend on their protocols:

- **The management contract shape.** `ChatManagementServiceContract<S>` is parameterised by a provider's schema bundle (`SlackManagementSchemas`, `DiscordManagementSchemas`). Each provider still owns its RPC group, its method names, and its connection and channel schemas.
- **The authorization every management operation shares.** `makeChatManagementRpcHandlers` applies the `integrations.manage` policy and the plan's integrations capability on `connectStart`; each provider's `*-rpc-handlers.ts` maps that record onto its own method names.
- **The inbound feedback intake.** `ChatFeedbackService` is one service; `createPost` takes the post source (`SLACK`, `DISCORD`), so a chat submission reaches the shared post write path through one seam.
- **The connection row lookup and lock, the credential-decryption wrapper, and the API-failure mapping.** `findChatConnection`, `lockChatConnection`, `decryptChatCredentials`, `mapChatApiError`, and `mapChatManagementError` are parameterised by the provider key, the display label, and the credential shape.
- **The OAuth callback URL parser** and the shared failure vocabulary (`ChatInboundFailure`, `ChatIntegrationErrors`).

The provider packages keep their protocol work: API clients, signature verification, credential material, connection and channel services, inbound payload schemas, routers, manifests, and provider registration. Their `*-management-shared.ts` files shrink to bindings, and their `*-rpc-handlers.ts` files map the shared handler record onto their own RPC methods.

Collapsing the connection and channel services behind a `ChatProvider` adapter interface is deliberately not part of this decision. Those services are 29–52% different, and the adapter interface has no second shape to justify it yet; a third chat provider is the signal to revisit it.

## Why

The two providers had drifted into a copy. After normalising the provider name, `rpc-handlers.ts` and its test were byte-identical, `feedback-service.ts` differed by a comment wrap, and `management-shared.ts` by one credential field name. That is roughly a thousand lines of behaviour with two homes: a fix to the connection lookup, the feedback intake, or the entitlement gate had to be made twice, and a third chat provider would have made it three times.

The seam is real rather than hypothetical — two adapters already vary across it, and they vary in exactly the places the shared module does not touch (OAuth flow, API, payload shapes, credential material). The RPC contracts stay per provider because their method names and schemas are the provider's published surface, and `RpcHandlerRegistrations` keeps both groups provider-owned (ADR 0002).

The shared module lives in `packages/domain`, not `integration-core`, because the intake writes posts through `PostWriteService` and the handler factory reads `EntitlementPolicy` and `Policy` — domain dependencies that `integration-core` does not have and must not gain.
