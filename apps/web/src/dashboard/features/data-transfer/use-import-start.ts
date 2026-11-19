import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { useMachine } from "@xstate/react";
import { useCallback } from "react";

import {
  importStartMachine,
  type ImportStartPhase,
  toImportStartPhase,
} from "./import-start-machine";

/**
 * The message a failed start should show.
 *
 * An RPC failure carries the server's own sentence; a CSV upload is an
 * ordinary `fetch` whose handler throws the envelope message, and a transport
 * failure has nothing to say beyond the caller's fallback. Reading them in one
 * place keeps both dialogs saying the same thing about the same failure.
 */
const errorMessage = (error: Error | null, fallback: string): string => {
  if (error === null) {
    return fallback;
  }

  const parsed = parseRpcError(error, fallback);

  if (parsed.kind === "rpc") {
    return parsed.message;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return fallback;
};

export type ImportStart = {
  readonly phase: ImportStartPhase;
  readonly error: string | null;
  /** Runs the start request, reporting its outcome to the machine. */
  readonly run: (action: () => Promise<void>) => Promise<void>;
  readonly retry: () => void;
};

/**
 * Drives one dialog's "start import" button.
 *
 * The graph lives in `import-start-machine.ts`; this hook is the adapter
 * between the button, the request and the machine. The request is not an
 * `invoke` because the same hook serves a CSV upload and a provider RPC, and
 * neither failure shape belongs in a machine that is otherwise pure.
 */
export function useImportStart(failureTitle: string): ImportStart {
  const [snapshot, send] = useMachine(importStartMachine);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      send({ type: "START" });

      try {
        await action();
        send({ type: "STAGED" });
      } catch (error) {
        send({
          message: errorMessage(
            error instanceof Error ? error : null,
            failureTitle
          ),
          type: "FAILED",
        });
      }
    },
    [failureTitle, send]
  );

  const retry = useCallback(() => {
    send({ type: "RETRY" });
  }, [send]);

  return {
    error: snapshot.context.error,
    phase: toImportStartPhase(snapshot),
    retry,
    run,
  };
}
