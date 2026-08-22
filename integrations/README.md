# Integration packages

Provider adapters for external systems (`github`, `slack`, `discord`,
`webhook`) plus the provider-neutral kernel (`core`). See
`docs/adr/0001` for the event/delivery architecture and `docs/adr/0002`
for how these packages relate to `@feeblo/domain`.

## Dependency rules

- Provider packages may depend on: `@feeblo/integration-core`,
  `@feeblo/domain-contracts`, `@feeblo/domain`, `@feeblo/db`, `@feeblo/id`,
  `effect`.
- `@feeblo/domain` must **not** depend on provider packages. RPC definitions
  (contracts) live in domain; handler layers and HTTP adapters live here and
  are supplied by the server composition root.
- Server-only concerns (typed env, middleware) never leak into these packages:
  adapter factories take plain input objects instead.

## Standard layout

All source files are prefixed with the provider name; one concern per file.

```
integrations/<provider>/src/
  <provider>-manifest.ts            Provider key, capability keys, config/route schemas,
                                    registration metadata
  <provider>-credentials.ts         Credential encryption/decryption helpers
  <provider>-inbound-schema.ts      Verified inbound payload contract (thin re-export when
                                    the canonical schema lives in @feeblo/domain-contracts)
  <provider>-api*.ts                External API clients, auth/JWT helpers, request signing
  <provider>-oauth-callback.ts      OAuth / App-installation callback URL parsing
  <provider>-rule-evaluation.ts     Pure decision logic (no I/O)
  <provider>-external-resource.ts   Remote-resource drafts and field mapping
  <provider>.ts                     Service contract: Context tag + interface + `.of`
  <provider>-provider-live.ts       Adapter Live layer implementing the service contract;
                                    built by `make<Provider>ProviderLive(input)` taking a
                                    plain config object
  <provider>-management-live.ts     Live management service
  <provider>-inbound-live.ts        Live inbound (webhook) service
  <provider>-rpc-handlers.ts        RPC handler layer bound to the domain-defined RPC group;
                                    provided to `makeRpcRoute` by the server
  <provider>-routers.ts             HTTP route adapters (webhook endpoints, OAuth redirects);
                                    built by `make<Provider>Routers({ appUrl, registry })`
  <provider>*.test.ts               Colocated tests (db-backed suites reuse
                                    packages/domain/test rig via vitest.config.ts)
  index.ts                          Public barrel re-export
```

Naming: factories are `make<CamelCaseName>`; Live-layer inputs are
`<Name>Input`; router inputs `<Name>RoutersInput`. Export every public module
in `package.json` `exports` with a `./<file-without-ext>` subpath.

## Shared HTTP plumbing

Header extraction, settings redirects, and the verified-inbound pipeline live
once in `integration-core` (`./http-inbound`); provider routers compose them.
