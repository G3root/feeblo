import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { Turnstile, type TurnstileInstance } from "@marsidev/react-turnstile";
import { useCallback, useRef, useState, type Ref } from "react";

export function useTurnstile() {
  const siteKey = getRuntimePublicEnv().turnstileSiteKey;
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
