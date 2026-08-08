# Widget SSO (JWT) — integration contract

Feeblo's feedback widget can verify who is submitting feedback via JWT-based
SSO. The customer's own backend mints a short-lived JWT for the signed-in user,
the widget passes it to Feeblo, and Feeblo verifies the signature against the
**workspace's own secret** before creating/upserting the restricted SSO user
and its linked contact.

This document is the source of truth for the token contract. The enforcement
lives in `packages/domain/src/jwt-secret/verification.ts` (`verifyJwt`), the
SSO program in `packages/domain/src/widget/sso.ts` (`createSsoSession`), and
the widget feedback path in `packages/domain/src/widget/api-live.ts`.

## Getting the secret

1. Open **Settings → Security** in the dashboard (`workspace.update` required).
2. Click **Generate Secret** if none exists yet. The page displays the active
   secret and lets you copy it; put it into your backend's configuration.
   Treat it as a tenant credential — anyone holding it can mint SSO tokens for
   that workspace.

Secrets are **never auto-created** — merely probing an org id cannot
materialize a signing secret. Widget SSO stays disabled until an admin
generates one.

## Token contract

- **Algorithm**: `HS256`
- **Key**: the workspace's JWT secret (a 64-char hex string)
- **Transport**: the widget sends the token to the SSO endpoint along with the
  workspace id; the widget feedback path accepts it as the `token` field.

### Required claims

| Claim | Value | Why |
| --- | --- | --- |
| `aud` | **Your workspace id** (from the widget config) | Pins the token to exactly one workspace. A token minted for workspace A is rejected at workspace B even if both secrets leaked. |
| `userId` | Your stable id for this user | Used as the contact's `externalId` and to dedupe the SSO user. |
| `email` | User's email | Required; the SSO session and contact are keyed on it. |
| `name` | Display name | Required. |

`aud` must be a **single string** — an array or a missing/`iss`-only token is
rejected.

### Recommended claims

| Claim | Value | Why |
| --- | --- | --- |
| `exp` | UNIX timestamp; keep it short (≤ 5 minutes is plenty) | Not required, but **strongly recommended**: if present it is validated (an expired token is rejected), it bounds the 24h rotation grace window, and it limits how long a leaked token stays valid. |

### Optional claims

- `avatar` — profile image URL.
- Custom attribute values and nested `companies` (see
  `packages/domain/src/contact/utils.ts` `parsePersonAttributes` for the exact
  shape; attribute definitions are configured per workspace).

## Example (Node.js, `jose`)

```ts
import { SignJWT } from "jose";

const workspaceId = process.env.FEEBLO_WORKSPACE_ID; // from the widget config
const secret = process.env.FEEBLO_SSO_SECRET;        // from Settings → Security

const token = await new SignJWT({
  userId: user.id,
  email: user.email,
  name: user.name,
  // custom attributes: { email: { value: user.plan } } …
})
  .setProtectedHeader({ alg: "HS256" })
  .setAudience(workspaceId) // REQUIRED — binds to the workspace
  .setExpirationTime("5m") // strongly recommended, optional
  .sign(new TextEncoder().encode(secret));
```

## Rotation & revocation

- **Rotate** (Settings → Security): the current secret is revoked and a new one
  becomes active. Tokens signed with the previous secret keep verifying for a
  **24-hour grace period**, so rotate at a low-traffic moment and mint tokens
  with short `exp` values.
- **Revoke immediately**: the secret is dropped right away; tokens signed with
  it stop working immediately.
- Only the active secret plus the most recent grace-period secret are ever
  accepted. Expired revoked secrets are pruned.

## Error codes

The SSO endpoint maps failures to better-auth errors via the `jwt-auto-login`
plugin (`packages/auth/src/plugins/jwt-auto-login`):

| Code | Meaning |
| --- | --- |
| `ORGANIZATION_HAS_NO_JWT_SECRET` | No secret generated yet; generate one in Settings → Security. |
| `INVALID_JWT` | Signature invalid, wrong `aud`, an expired `exp` (when present), or wrong/leaked secret. |
| `SSO_TOKEN_MISSING_EMAIL_OR_NAME` | Required `email`/`name` (or `userId`) missing. |
| `FAILED_TO_CREATE_SSO_USER` / `FAILED_TO_CREATE_SSO_CONTACT` | Persistence failure while upserting the user/contact. |

## Security notes

- **`aud` binding is required, not optional.** The per-workspace secret already
  prevents cross-workspace forgery; `aud` is defense-in-depth that keeps the
  tenant binding intact even if a verification path ever runs against a pool of
  secrets or a stateless edge verifier derives the workspace from the token.
- Mint tokens **on-demand, per request**, with a short `exp` — never long-lived
  API keys. (Enforced `exp` is not part of the contract, so treat it as your
  own mitigation for leaked tokens.)
- The signing secret is a tenant credential: keep it in server-side config only,
  never ship it to the browser.
- SSO sessions are restricted to the workspace (`restrictedToOrganizationId`)
  and cannot be used to access the dashboard.

## Tests

The contract is locked by tests:

- `packages/domain/src/jwt-secret/verification.test.ts` — claim-level rules
  (wrong/missing `aud`, `exp` optional but expired tokens rejected when `exp`
  is present, wrong secret).
- `packages/domain/src/widget/sso.test.ts` — end-to-end `createSsoSession`
  against a real database (valid token creates a restricted user; mismatched
  `aud`, missing `aud`, expired token, foreign secret, and no-secret cases all
  behave as documented).
