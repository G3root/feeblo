import { useFeeblo } from "./context";
import { FeebloProvider, type FeebloProviderProps } from "./provider";
import { HOST_ORIGIN } from "./test-helpers";

/**
 * Provider with test-friendly defaults: the embed iframe points at the local
 * test server and the floating container is shrunk to a corner so it never
 * covers the probe controls.
 */
export function TestProvider(
  props: Omit<FeebloProviderProps, "baseUrl" | "containerStyles">
): React.JSX.Element {
  return (
    <FeebloProvider
      baseUrl={HOST_ORIGIN}
      containerStyles={{ height: "2px", width: "2px" }}
      {...props}
    />
  );
}

/**
 * Renders the context state as text plus buttons that drive every action, so
 * tests can interact with the widget through real DOM events.
 */ export function StateProbe(): React.JSX.Element {
  const feeblo = useFeeblo();

  return (
    <div>
      <output>ready:{feeblo.isReady ? "yes" : "no"}</output>
      <output>open:{feeblo.isOpen ? "yes" : "no"}</output>
      <button onClick={() => feeblo.open()} type="button">
        open
      </button>
      <button onClick={() => feeblo.close()} type="button">
        close
      </button>
      <button onClick={() => feeblo.openModule("updates")} type="button">
        module
      </button>
      <button onClick={() => feeblo.setBoard("roadmap")} type="button">
        board
      </button>
      <button onClick={() => feeblo.identify({ id: "u_probe" })} type="button">
        identify
      </button>
      <button onClick={() => feeblo.metadata({ plan: "pro" })} type="button">
        metadata
      </button>
    </div>
  );
}
