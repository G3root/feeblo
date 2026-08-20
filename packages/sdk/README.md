# @feeblo/sdk

Embeddable feedback widget SDK for [Feeblo](https://github.com/G3root/feeblo). Drop the widget into any web app, bind it to triggers, identify your users, and listen for widget events — all from a tiny, dependency-light script.

## Install

```bash
pnpm add @feeblo/sdk
# or
npm install @feeblo/sdk
```

For a no-build setup, load it from a CDN as a regular script tag (see [Auto-init](#auto-init)).

## Quick start

```ts
import { Feeblo } from "@feeblo/sdk";

Feeblo.init("org_123", {
  user: { id: "u_1", email: "ada@example.com", name: "Ada Lovelace" },
}).setBoard("roadmap");
```

`init` returns a chainable widget handle, so you can fluently configure it:

```ts
const widget = Feeblo.init("org_123");
widget.identify(user).setBoard("roadmap").open();
```

### Widget modes

Focused feedback remains the default. Use `updates` for a card-based product updates panel, or combine an ordered subset of modules in Feeblo Hub:

```ts
Feeblo.init("org_123", { mode: "feedback" });

Feeblo.init("org_123", {
  mode: "updates",
  placement: "bottom-left",
});

const hub = Feeblo.init("org_123", {
  mode: "hub",
  modules: ["updates", "feedback"],
  placement: "bottom-right",
});

hub.openModule("feedback");
```

`placement` renders Feeblo's launcher in the selected bottom corner. Omit it to keep programmatic and `data-feeblo-feedback` triggers as the only ways to open the widget. Hub requires at least one unique module and initially shows the first module in the array.

### Config-object form

Prefer a single object? `init` accepts a config object too:

```ts
Feeblo.init({
  organizationId: "org_123",
  theme: "dark",
  debug: true,
  user: { id: "u_1" },
});
```

## Identifying users

```ts
import { Feeblo, type UserIdentity } from "@feeblo/sdk";

const user: UserIdentity = {
  id: "u_1",
  email: "ada@example.com",
  name: "Ada Lovelace",
  avatar: "https://example.com/ada.png",
  customFields: { title: "Product Manager" },
  companies: [
    {
      id: "c_1",
      name: "Acme",
      avatar: "https://example.com/acme.png",
      customFields: { industry: "SaaS" },
    },
  ],
};

Feeblo.identify(user);
```

`id` is required; all other fields are optional.

- Use `name` for the user's full name. `firstName` and `lastName` are still accepted but deprecated; they are normalized into `name` when provided.
- `token` is **required** for submitting feedback. It must be a JWT signed by your organization's Feeblo secret (see [Server-side JWT](#server-side-jwt)).

### Typed organization IDs

For integrators who want to distinguish widget IDs from arbitrary strings at type-check time, use the branded `OrganizationId` helper:

```ts
import { Feeblo, organizationId } from "@feeblo/sdk";

const ORG = organizationId("org_123");
Feeblo.init(ORG);
```

Plain strings remain accepted everywhere — the brand is strictly opt-in.

## Server-side JWT

Feedback submissions require an authenticated user. Generate a JWT on your server using your organization's Feeblo secret (found in Settings → Security):

```ts
import jwt from "jsonwebtoken";

const token = jwt.sign(
  {
    userId: user.id, // required
    email: user.email, // required
    name: user.name, // required
    companies: [
      // optional
      { id: company.id, name: company.name },
    ],
  },
  process.env.FEEBLO_ORG_SECRET,
  { algorithm: "HS256" }
);
```

Then pass the token to the SDK:

```ts
Feeblo.identify({
  id: user.id,
  email: user.email,
  name: user.name,
  token,
});
```

## Public board auto-login

You can also use the same JWT to sign users into your public Feeblo board automatically. Redirect them to:

```
https://feedback.yourdomain.com/?ssoToken=JWT
```

Feeblo will verify the token, create a session, and redirect the user back with the token removed from the URL.

Links marked with `data-feeblo-link` receive the JWT from the most recent `identify` call automatically when the user interacts with them:

```html
<a href="https://feedback.yourdomain.com/" data-feeblo-link> Give feedback </a>
```

The SDK adds `?ssoToken=JWT` on mouse, keyboard, and context-menu interaction. The public board exchanges it for a restricted session cookie and immediately removes the token from the visible URL.

## Triggers

Any element with the `data-feeblo-feedback` attribute automatically opens the widget when clicked. The SDK continuously scans the DOM for new triggers, so they can be added at any time.

```html
<button data-feeblo-feedback>Feedback</button>
```

Pass extra context via `data-feeblo-*` attributes. Keys are camel-cased after the `feeblo` prefix, so `data-feeblo-board` becomes `board`:

```html
<button data-feeblo-feedback data-feeblo-board="roadmap">Roadmap ideas</button>
```

You can also open the widget programmatically:

```ts
Feeblo.open();
Feeblo.close();
```

## Events

Subscribe to widget lifecycle events with a typed `on`/`off` API. Callbacks receive a `CustomEvent` whose `detail` is narrowed by event name.

```ts
import { Feeblo, type FeebloEventName } from "@feeblo/sdk";

const off = Feeblo.on("feedbackSubmitted", (e) => {
  console.log("posted", e.detail.data); // SubmittedFeedback | undefined
});

Feeblo.on("widgetReady", () => console.log("ready"));
Feeblo.on("widgetOpened", (e) => console.log("opened", e.detail.data));

// Listen to everything:
Feeblo.on("*", (e) => {
  console.log(e.detail.type, e.detail.data);
});

off(); // unsubscribe
```

Supported events: `widgetReady`, `widgetOpened`, `feedbackSubmitted` (or `*` for all three). `on` returns an unsubscribe function.

## Debugging

Pass `debug: true` to stream diagnostics to the console — postMessage traffic (in/out), lifecycle transitions, floating-ui positioning, and trigger binding, all prefixed with `[feeblo:<category>]`:

```ts
Feeblo.init("org_123", { debug: true });
```

The current SDK version is available on the namespace:

```ts
import { Feeblo } from "@feeblo/sdk";
console.log(Feeblo.version);
```

## Options

| Option | Type | Description |
| --- | --- | --- |
| `baseUrl` | `string` | Override the widget host. Defaults to `https://app.feeblo.com` (or `localhost:3001` in dev). |
| `theme` | `string` | Widget theme, forwarded as a query param. |
| `mode` | `"feedback" \| "updates" \| "hub"` | Widget experience. Defaults to `feedback`. |
| `modules` | `Array<"feedback" \| "updates">` | Ordered Hub modules. Defaults to feedback then updates. |
| `placement` | `"bottom-left" \| "bottom-right"` | Render a launcher in the selected bottom corner. |
| `user` | `UserIdentity` | Identify the current user on init. |
| `debug` | `boolean` | Enable diagnostic logging. |
| `root` | `HTMLElement` | Where to mount the widget container. Defaults to `document.body`. |
| `containerStyles` | `Partial<CSSStyleDeclaration>` | Override the floating container styles. |
| `onClose` | `() => void` | Called when the widget closes itself. |
| `onError` | `(error: EmbedError) => void` | Called with structured errors (`code` + `message`). |
| `onHeightChange` | `(height: number) => void` | Called when the widget reports a new height. |

## Auto-init

When loaded as a `<script>` tag, the SDK auto-initialises from a global config or the script's `data-feeblo-*` attributes — no JavaScript required:

```html
<script
  async
  src="https://unpkg.com/@feeblo/sdk"
  data-feeblo-organization-id="org_123"
  data-feeblo-theme="dark"
  data-feeblo-debug="true"
></script>
```

Or via a global config placed before the script:

```html
<script>
  window.feebloConfig = { organizationId: "org_123", theme: "dark" };
</script>
<script async src="https://unpkg.com/@feeblo/sdk"></script>
```

## API

### `Feeblo` namespace

| Member | Description |
| --- | --- |
| `version` | The installed SDK version. |
| `init(id, opts?)` | Initialise the widget. Returns a chainable `FeebloWidget`. |
| `identify(user)` | Identify or update the current user. Chainable. |
| `open()` | Open the widget. Chainable. |
| `openModule(name)` | Open an enabled module. Chainable. |
| `close()` | Close the widget. Chainable. |
| `setBoard(board)` | Switch the active board. Chainable. |
| `destroy()` | Tear down the widget and release listeners. |
| `on(event, cb)` | Subscribe to an event (`*` for all). Returns an unsubscribe function. |
| `off(event, cb)` | Unsubscribe a previously registered callback. |
| `organizationId` | Brand a string as an `OrganizationId`. |

### Errors

SDK errors are thrown or reported as `EmbedError`, which carries a stable `code` (e.g. `INVALID_ORG`, `INVALID_IDENTITY`) alongside `message`.

## React integration — `@feeblo/sdk/react`

A React-friendly layer over the vanilla SDK. It follows Vercel React best practices (stable callbacks, primitive effect deps, `useRef` for transient widget handles, `useMemo` for context) and is fully tested with Vitest Browser Mode + Playwright.

```bash
pnpm add @feeblo/sdk react react-dom
```

### Basic usage

```tsx
import { FeebloProvider, FeebloTrigger } from "@feeblo/sdk/react";

function App() {
  return (
    <FeebloProvider organizationId="org_123" mode="feedback">
      <header>
        <h1>My App</h1>
        <FeebloTrigger>Give feedback</FeebloTrigger>
      </header>
    </FeebloProvider>
  );
}
```

`FeebloTrigger` renders an accessible `<button>` that opens the widget anchored to itself via Floating UI. Use `asChild` to attach the behaviour to any element:

```tsx
<FeebloTrigger asChild>
  <a href="#">Feedback</a>
</FeebloTrigger>
```

### Identifying users

Pass `user` to the provider — changes are propagated via `identify` without re-creating the widget (stringified key, separate effect):

```tsx
<FeebloProvider organizationId="org_123" user={{ id: "u_1", email: "ada@example.com", name: "Ada" }}>
  <App />
</FeebloProvider>
```

Or imperatively via the hook:

```tsx
import { useFeeblo } from "@feeblo/sdk/react";

function SignInButton() {
  const { identify } = useFeeblo();
  return (
    <button onClick={() => identify({ id: "u_2", email: "grace@example.com", name: "Grace" })}>
      Sign in
    </button>
  );
}
```

### Controlled open / close

```tsx
import { useFeeblo } from "@feeblo/sdk/react";

function Controls() {
  const { isOpen, isReady, open, close, setBoard, openModule } = useFeeblo();
  return (
    <>
      <span>{isReady ? "ready" : "loading"} · {isOpen ? "open" : "closed"}</span>
      <button onClick={() => open()}>Open</button>
      <button onClick={() => close()}>Close</button>
      <button onClick={() => openModule("updates")}>What&apos;s new</button>
      <button onClick={() => setBoard("roadmap")}>Roadmap board</button>
    </>
  );
}
```

### Events — `useFeebloEvent`

Stay subscribed with a stable ref (handler identity never forces resubscribe):

```tsx
import { useFeebloEvent, useOnFeedbackSubmitted } from "@feeblo/sdk/react";

function Analytics() {
  useFeebloEvent("widgetOpened", (e) => console.log("opened", e.detail.data));
  useFeebloEvent("feedbackSubmitted", (e) => console.log("feedback", e.detail.data));
  // Convenience alias:
  useOnFeedbackSubmitted((e) => toast.success(`Submitted: ${e.detail.data?.title}`));
  return null;
}
}
```

Wildcard subscription (`"*"`) is also supported.

### Hub / placement / boards

```tsx
// Hub with launcher in bottom-right
<FeebloProvider organizationId="org_123" mode="hub" modules={["feedback", "updates"]} placement="bottom-right">
  <FeebloTrigger module="updates">What&apos;s new</FeebloTrigger>
  <FeebloTrigger module="feedback">Feedback</FeebloTrigger>
</FeebloProvider>

// Board-scoped trigger
<FeebloTrigger board="bugs" metadata={{ source: "pricing-page" }}>Report a bug</FeebloTrigger>
```

All `EmbedOptions` (`baseUrl`, `theme`, `locale`, `containerStyles`, `onError`, etc.) are accepted as provider props and memoised on primitive keys so the widget is not torn down unless a structural option actually changes.

### Hook API

| Hook | Description |
| --- | --- |
| `useFeeblo()` | Full context: `widget`, `isReady`, `isOpen`, `open`, `close`, `identify`, `setBoard`, `metadata`, `openModule` |
| `useFeebloEvent(event, handler)` | Subscribe to `widgetReady`, `widgetOpened`, `widgetClosed`, `feedbackSubmitted`, … |
| `useOnFeedbackSubmitted(handler)` | Alias for `useFeebloEvent("feedbackSubmitted", …)` |
| `useFeebloIsReady()` / `useFeebloIsOpen()` | Derived boolean selectors |
| `useFeebloWidget()` | Nullable `FeebloWidget` handle |
| `useFeebloTrigger(options)` | Headless `ref` + `onClick` for custom elements |

### Examples

See `src/react/examples/`:

- `basic.example.tsx` — minimal + controlled + events
- `with-identify.example.tsx` — provider `user`, hook `identify`, anonymous → identified
- `hub.example.tsx` — hub modules, board scoping, launcher-only

### Testing

React integration tests run in Vitest Browser Mode (Chromium + Playwright) and are colocated with the source:

```bash
pnpm -F @feeblo/sdk test        # unit (happy-dom) + browser (chromium)
```

Browser specs: `src/react/*.browser.test.tsx` — cover provider lifecycle, `useFeebloEvent` ref stability & cleanup, `FeebloTrigger` (`asChild`, `board`/`metadata` forwarding, `defaultPrevented` guard) and `useFeebloTrigger`.

## Local development

```bash
pnpm -F @feeblo/sdk dev      # Vite preview harness at http://localhost:5173
pnpm -F @feeblo/sdk build    # Emits dist/feeblo-sdk.js + UMD + type declarations
pnpm -F @feeblo/sdk check-types
pnpm -F @feeblo/sdk lint
```

## License

AGPL-3.0-only
