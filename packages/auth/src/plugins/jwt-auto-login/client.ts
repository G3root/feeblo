import type { BetterAuthClientPlugin } from "@better-auth/core";
import { JWT_AUTO_LOGIN_ERROR_CODES } from "./error-codes";
import { ID, type jwtAutoLogin, SIGN_IN_PATH } from "./plugin";

export const jwtAutoLoginClient = () => {
  return {
    id: ID,

    $InferServerPlugin: {} as ReturnType<typeof jwtAutoLogin>,
    pathMethods: {
      [SIGN_IN_PATH]: "POST",
    },
    atomListeners: [
      {
        matcher: (path) => path === SIGN_IN_PATH,
        signal: "$sessionSignal",
      },
    ],
    $ERROR_CODES: JWT_AUTO_LOGIN_ERROR_CODES,
  } satisfies BetterAuthClientPlugin;
};
