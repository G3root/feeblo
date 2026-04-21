import { initAuthHandler } from "@feeblo/auth/server";
import { DB } from "@feeblo/db";
import { ManagedRuntime } from "effect";

const authRuntime = ManagedRuntime.make(DB.Client);

export const getAuth = () => authRuntime.runPromise(initAuthHandler());
