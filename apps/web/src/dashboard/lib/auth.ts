import { initAuthHandler } from "@feeblo/auth/server";
import { Database } from "@feeblo/db";
import * as ManagedRuntime from "effect/ManagedRuntime";

const authRuntime = ManagedRuntime.make(Database.DatabaseContextLive);

export const getAuth = () => authRuntime.runPromise(initAuthHandler());
