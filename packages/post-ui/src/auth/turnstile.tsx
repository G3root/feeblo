import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useCallback, useEffect, useRef, useState, type Ref } from "react";

export function useTurnstile() {
  // Read the key after mount, never during render. The runtime env is injected
  // into the document before hydration, so on the server it is always empty:
  // reading it while rendering made a server-rendered form (the `_auth` pages)
  // ship an enabled submit button with no widget, while the browser's first
  // render disabled the button and mounted the widget. React discarded
  // hydration for the document (error #418), and the visitor briefly saw a
  // button that looked ready before the CAPTCHA had run. Deferring one render
  // keeps both sides identical; the widget only ever loads in the browser.
  const [siteKey, setSiteKey] = useState<string | undefined>(undefined);

  useEffect(() => {
    setSiteKey(getRuntimePublicEnv().turnstileSiteKey);
  }, []);

  const isEnabled = !!siteKey;
  const ref = useRef<TurnstileInstance>(null);
  const [token, setToken] = useState<string | null>(null);

  const reset = useCallback(() => {
    setToken(null);
    ref.current?.reset();
  }, []);

  const handleError = useCallback(() => {
    setToken(null);
    ref.current?.reset();
  }, []);

  const handleExpire = useCallback(() => {
    setToken(null);
    ref.current?.reset();
  }, []);

  const handleSuccess = useCallback((nextToken: string) => {
    setToken(nextToken);
  }, []);

  return {
    handleError,
    handleExpire,
    handleSuccess,
    isEnabled,
    ref,
    reset,
    siteKey,
    token,
  };
}

interface TurnstileFieldProps {
  onError: () => void;
  onExpire: () => void;
  onSuccess: (token: string) => void;
  ref: Ref<TurnstileInstance | null>;
  siteKey: string | undefined;
}

export function TurnstileField({
  onError,
  onExpire,
  onSuccess,
  ref,
  siteKey,
}: TurnstileFieldProps) {
  if (!siteKey) {
    return null;
  }

  return (
    <Turnstile
      onError={onError}
      onExpire={onExpire}
      onSuccess={onSuccess}
      options={{ size: "flexible" }}
      ref={ref}
      siteKey={siteKey}
    />
  );
}
