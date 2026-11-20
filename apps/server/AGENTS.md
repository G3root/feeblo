# apps/server

The HTTP composition root. This is the only place layers are assembled: `src/app/router.ts` and `src/app/layers.ts` merge the domain handler layers, supply the four provider-owned groups, and build the runtime that `src/app/program.ts` starts. If an Effect error or a requirement channel looks wrong at a boundary, the fix belongs here.

`packages/domain` does not depend on any provider package. `src/integrations.ts` supplies their handler layers, registry and delivery worker from `@feeblo/integration-core` and the `integrations/*` packages, so a provider-owned RPC group cannot be half-wired: the map satisfies `ProviderOwnedRpcName` and a missing entry is a compile error.

## The four surfaces

Deliberately not sharing one contract.

- **Dashboard RPC** — session-authenticated Effect RPC over `/rpc`.
- **Public API** — versioned, API-key-authenticated `/api/v1`. DTOs are hand-written in `packages/domain/src/public-api/schema.ts`; see `docs/public-api.md`.
- **SDKs** — `packages/sdk`, `packages/sdk-react`. Published, so the public shape is a contract.
- **Integrations** — provider registry plus the durable delivery worker.

## HTTP

`src/http/` owns the cross-cutting request layer: security headers, CORS, origin check, body limit, request rejection, HTTP metrics, server timing and browser telemetry. An endpoint's behaviour there applies to every surface, so read the neighbouring test before changing a module in that directory. `docs/security-headers.md` explains which directive is load-bearing and why.
