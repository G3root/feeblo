# Widget SSO (JWT) — integration contract

Feeblo's feedback widget can verify who is submitting feedback via JWT-based SSO. The customer's own backend mints a short-lived JWT for the signed-in user, the widget passes it to Feeblo, and Feeblo verifies the signature against the **workspace's own secret** before creating/upserting the restricted SSO user and its linked contact.

This document is the source of truth for the token contract. The enforcement lives in `packages/domain/src/jwt-secret/verification.ts` (`verifyJwt`), the SSO program in `packages/domain/src/widget/sso.ts` (`createSsoSession`), and the widget feedback path in `packages/domain/src/widget/api-live.ts`.

## Getting the secret

1. Open **Settings → Security** in the dashboard (`workspace.update` required).
2. Click **Generate Secret** if none exists yet. The page displays the active secret and lets you copy it; put it into your backend's configuration. Treat it as a tenant credential — anyone holding it can mint SSO tokens for that workspace.

Secrets are **never auto-created** — merely probing an org id cannot materialize a signing secret. Widget SSO stays disabled until an admin generates one.

## Token contract

- **Algorithm**: `HS256`
- **Key**: the workspace's JWT secret (a 64-char hex string)
- **Transport**: the widget sends the token to the SSO endpoint along with the workspace id; the widget feedback path accepts it as the `token` field.

### Required claims

| Claim | Value | Why |
| --- | --- | --- |
| `aud` | **Your workspace id** (from the widget config) | Pins the token to exactly one workspace. A token minted for workspace A is rejected at workspace B even if both secrets leaked. |
| `sub` | A stable, unchanging **string** identifier for this user | **The only identity claim** (RFC 7519 subject). Must be a string; non-string values are rejected. Used as the contact's `externalId` and to dedupe the SSO user. |
| `email` | User's email | Required; the SSO session and contact are keyed on it. |
| `name` | Display name | Required. |
| `exp` | UNIX timestamp; keep it short (≤ 5 minutes is plenty) | **Required and enforced.** Tokens without `exp` are rejected. |
| `iat` | UNIX timestamp of mint time | **Required and enforced.** Tokens without `iat` are rejected, and an `iat` more than 10s in the future is rejected. |

`aud` must be a **single string** — an array or a missing/`iss`-only token is rejected.

There are no legacy fallbacks: the identity must come from `sub`. Any other identity claim (e.g. `userId`) is not read.

### Enforced at verification time

Beyond the signature and the required claims, `verifyJwt` enforces (all failures map to `INVALID_JWT`):

- **`exp` required** — a token without it is rejected after the signature verifies.
- **`iat` required** — a token without it is rejected after the signature verifies; non-numeric time claims are rejected too.
- **Total lifetime capped**: `exp - iat` may not exceed the workspace cap — **24 hours by default**, overridable per workspace via `organization.jwt_max_token_lifetime_minutes` (contact support to tighten it; shortening the cap is the only supported direction). A token claiming `exp = now + 30 days` is rejected even though the signature is valid. Keep minting short-lived tokens (≤ 5 minutes); the cap only bounds the worst case for a leaked token.
- **`iat` not in the future** — more than 10s ahead of Feeblo's clock is rejected.
- **10s clock-skew leeway** for `exp`/`nbf`/`iat` checks, so a slightly-skewed issuer clock does not break sign-ins.

### Recommended claims

| Claim | Value | Why |
| --- | --- | --- |
| `iss` | Your app URL (e.g. `https://app.example.com`) | Not verified yet — the issuer is stored unverified. Setting it now means the workspace can be migrated to issuer verification (planned to be promoted to required) without a second token change. Until then it is informational only. |

### Optional claims

- `avatar` — profile image URL.
- Custom attribute values and nested `companies` (see `packages/domain/src/contact/utils.ts` `parsePersonAttributes` for the exact shape; attribute definitions are configured per workspace). Attribute values must be **JSON scalars** (string, number, boolean, null); arrays and nested objects are **ignored** — they are never persisted or rendered.

## Example (Node.js, `jose`)

```ts
import { SignJWT } from "jose";

const workspaceId = process.env.FEEBLO_WORKSPACE_ID; // from the widget config
const secret = process.env.FEEBLO_SSO_SECRET; // from Settings → Security (64-char hex)

const token = await new SignJWT({
  sub: user.id,
  email: user.email,
  name: user.name,
  // custom attributes: { email: { value: user.plan } } …
})
  .setProtectedHeader({ alg: "HS256" })
  .setAudience(workspaceId) // REQUIRED — binds to the workspace
  .setIssuer("https://app.example.com") // recommended — issuer verification coming
  .setIssuedAt() // REQUIRED — tokens without iat are rejected
  .setExpirationTime("5m") // REQUIRED
  .sign(new Uint8Array(Buffer.from(secret, "hex")));
```

## Rotation & revocation

- **Rotate** (Settings → Security): the current secret is revoked and a new one becomes active. Tokens signed with the previous secret keep verifying for a **24-hour grace period**, so rotate at a low-traffic moment and mint tokens with short `exp` values.
- **Revoke immediately**: the secret is dropped right away (its tokens stop verifying immediately), and a new secret is generated. The grace period still applies to the immediately-revoked secret.
- Only the active secret plus the most recent grace-period secret are ever accepted. Expired revoked secrets are pruned.

## Error codes

The SSO endpoint maps failures to better-auth errors via the `jwt-auto-login` plugin (`packages/auth/src/plugins/jwt-auto-login`):

| Code | Meaning |
| --- | --- |
| `ORGANIZATION_HAS_NO_JWT_SECRET` | No secret generated yet; generate one in Settings → Security. |
| `INVALID_JWT` | Signature invalid, wrong/missing `aud`, missing/non-numeric `exp` or `iat`, expired `exp` (beyond leeway), `iat` too far in the future, token lifetime beyond the workspace cap, or wrong/leaked secret. |
| `SSO_TOKEN_MISSING_EMAIL_OR_NAME` | Required `email`/`name` (or `sub`) missing. |
| `FAILED_TO_CREATE_SSO_USER` / `FAILED_TO_CREATE_SSO_CONTACT` | Persistence failure while upserting the user/contact. |
| `SSO_RATE_LIMITED` | Too many SSO attempts within the rate-limit window (429): unauthenticated attempts are limited by trusted client IP, and verified sign-ins are limited by workspace. |
| `SSO_RATE_LIMIT_UNAVAILABLE` | The SSO rate limiter is unavailable (503). |

## Security notes

- **`aud` binding is required, not optional.** The per-workspace secret already prevents cross-workspace forgery; `aud` is defense-in-depth that keeps the tenant binding intact even if a verification path ever runs against a pool of secrets or a stateless edge verifier derives the workspace from the token.
- Mint tokens **on-demand, per request**, with a short `exp` — never long-lived API keys. `exp` and the lifetime cap are enforced server-side, so a leaked token now ages out on a fixed schedule no matter what the minting side does.
- The signing secret is a tenant credential: keep it in server-side config only, never ship it to the browser.
- SSO sessions are restricted to the workspace (`restrictedToOrganizationId`) and cannot be used to access the dashboard.
- Prefer passing the SSO token in a fragment (`data-feeblo-link` widget flow) over a query string: query strings leak into logs, history and the `Referer` header, and a token in a URL is replayable until it expires.

## Tests

The contract is locked by tests:

- `packages/domain/src/jwt-secret/verification.test.ts` — claim-level rules (wrong/missing `aud`, missing `exp`, missing `iat`, expired `exp`, future `iat`, clock-skew leeway, 24h lifetime cap, per-workspace cap override, wrong secret).
- `packages/domain/src/widget/sso.test.ts` — end-to-end `createSsoSession` against a real database (valid token creates a restricted user; mismatched `aud`, missing `aud`, missing `exp`, missing `iat`, expired token, overlifetime token, per-org cap, foreign secret, and no-secret cases all behave as documented).
- `packages/domain/src/contact/utils.test.ts` / `jwt-parsing.test.ts` — `sub`-only identity resolution (legacy claims ignored/rejected) and scalar-only custom attribute values.
