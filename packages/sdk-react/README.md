# @feeblo/sdk-react

React bindings for [`@feeblo/sdk`](../sdk), the embeddable feedback widget SDK for [Feeblo](https://github.com/G3root/feeblo). Mount the widget declaratively, drive it with hooks, and subscribe to its events with full type safety.

## Install

```bash
pnpm add @feeblo/sdk-react @feeblo/sdk
# or
npm install @feeblo/sdk-react @feeblo/sdk
```

React 19 or newer is required.

## Quick start

Wrap your app in a `FeebloProvider` and call `useFeeblo` anywhere beneath it:

```tsx
import { FeebloProvider, useFeeblo } from "@feeblo/sdk-react";

function FeedbackButton() {
  const feeblo = useFeeblo();

  return <button onClick={feeblo.open}>Give feedback</button>;
}

export function App() {
  return (
    <FeebloProvider organizationId="org_123" theme="dark">
      <FeedbackButton />
    </FeebloProvider>
  );
}
```

## Provider lifecycle

- The widget is initialized when the provider mounts and destroyed when it unmounts (including in StrictMode double-mounts).
- Changing any config prop (`organizationId`, `theme`, `mode`, `modules`, `placement`, `baseUrl`, `locale`, `defaultBoard`, `debug`, `root`, `containerStyles`) recreates the embed; readiness resets until the new widget reports ready.
- Changing `user` re-identifies the live widget without recreating it. Setting `user` back to `undefined` does **not** sign the widget out — the underlying SDK has no clear-identity API, so the last identified user (and their token, used for feedback submission and `data-feeblo-link` auto-login) stays active until another `identify` call or a full provider remount.
- Callback props (`onClose`, `onError`, `onHeightChange`) are read through refs: inline closures never trigger re-initialization, and the widget always invokes the latest one.

The Feeblo SDK exposes a single global widget instance, so mount exactly one provider at the root of your tree — and pick **one** integration mode per page. Combining the provider with the CDN `<script>` auto-init (or any other direct `Feeblo.init` call) creates a second SDK instance: the two fight over the same embed container and split the event stream. Plain HTML triggers (`data-feeblo-feedback`, `data-feeblo-link`) are safe to keep alongside the provider — they bind to whichever instance the provider initialized.

## `useFeeblo`

Returns a stable API object plus reactive state:

| Member | Description |
| --- | --- |
| `isReady` | Whether the widget has finished loading. |
| `isOpen` | Whether the widget is currently open. Updated optimistically and corrected by widget events (ESC key, outside click, self-close). |
| `open()` | Open the widget. |
| `close()` | Close the widget. |
| `openModule(module)` | Open an enabled Hub module (`"feedback"` \| `"updates"`). |
| `setBoard(board)` | Switch the active board. |
| `identify(user)` | Identify or update the current user. |
| `metadata(patch)` | Merge context metadata; `null` values remove keys. |

## `useFeebloEvent`

Subscribe to typed widget events for the lifetime of a component:

```tsx
import { useFeebloEvent } from "@feeblo/sdk-react";

function SubmissionTracker() {
  useFeebloEvent("feedbackSubmitted", (event) => {
    analytics.track("feedback", event.detail.data);
  });

  return null;
}
```

Pass `"*"` to observe every event. Handlers may be inline closures — they are read through a ref, so updating one never resubscribes.

Supported events: `widgetReady`, `widgetOpened`, `widgetClosed`, `identityChanged`, `feedbackSubmitted`.

## Props reference

`FeebloProvider` accepts every [`EmbedOptions`](../sdk#options) field as a prop, plus `children`. The most common ones:

| Prop | Type | Description |
| --- | --- | --- |
| `organizationId` | `string` | **Required.** The Feeblo organization whose widget to mount. |
| `user` | `UserIdentity` | Identify the current user; updates without remounting. |
| `mode` | `"feedback" \| "updates" \| "hub"` | Widget experience. Defaults to `feedback`. |
| `modules` | `Array<"feedback" \| "updates">` | Ordered Hub modules (`mode="hub"` only). |
| `placement` | `"bottom-left" \| "bottom-right"` | Render the SDK launcher in that corner. |
| `theme` | `string` | Forwarded to the widget as a query param. |
| `debug` | `boolean` | Stream SDK diagnostics to the console. |
| `onClose` | `() => void` | Called when the widget closes itself. |
| `onError` | `(error: EmbedError) => void` | Called with structured errors. |
| `onHeightChange` | `(height: number) => void` | Called on widget height changes. |

## Local development

```bash
pnpm -F @feeblo/sdk-react test        # browser tests via vitest-browser-react
pnpm -F @feeblo/sdk-react check-types
pnpm -F @feeblo/sdk-react build       # ESM bundle + declarations into dist/
```

## Releases

Publishing is tag-triggered (`sdk-react@X.Y.Z`); see [`docs/sdk-releases.md`](../../docs/sdk-releases.md) for the runbook.

## License

AGPL-3.0-only
