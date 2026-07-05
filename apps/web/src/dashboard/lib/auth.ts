import { initAuthHandler } from "@feeblo/auth/server";
import { Database } from "@feeblo/db";
import { ManagedRuntime } from "effect";

const authRuntime = ManagedRuntime.make(Database.DatabaseContextLive);

export const getAuth = () => authRuntime.runPromise(initAuthHandler());
