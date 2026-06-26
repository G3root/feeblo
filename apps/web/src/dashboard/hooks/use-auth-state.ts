import { eq, useLiveQuery } from "@tanstack/react-db";
import { authStateCollection } from "~/lib/auth-client";

export const useAuthState = () => {
  const { data } = useLiveQuery((q) =>
    q
      .from({ auth: authStateCollection })
      .where(({ auth }) => eq(auth.id, "auth"))
      .findOne()
  );

  return data;
};
