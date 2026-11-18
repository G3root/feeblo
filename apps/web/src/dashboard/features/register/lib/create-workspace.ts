import { parseRpcError } from "@feeblo/web-shared/rpc-error";

import { fetchRpc } from "~/lib/runtime";

import type {
  CreateWorkspacePayload,
  CreateWorkspaceResult,
} from "./register-wizard-machine";

/**
 * The one write the wizard makes, with its failure turned into a sentence.
 *
 * The RPC client rejects with a transport-shaped error, and the machine only
 * knows how to show a string. Mapping here keeps the machine free of the RPC
 * layer, which is also what lets a test drive it without a server.
 */
export async function createWorkspace(
  payload: CreateWorkspacePayload
): Promise<CreateWorkspaceResult> {
  try {
    const created = await fetchRpc((rpc) =>
      rpc.CreateWorkspace({
        boardNames: [...payload.boardNames],
        subdomain: payload.subdomain,
        workspaceName: payload.workspaceName,
      })
    );

    return { ok: true, ...created };
  } catch (error) {
    return {
      message: parseRpcError(
        error,
        "Could not create the workspace. Try again."
      ).message,
      ok: false,
    };
  }
}
