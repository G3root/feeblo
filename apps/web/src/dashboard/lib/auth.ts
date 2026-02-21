import { initAuthHandler } from "@feeblo/auth";
import { DBLive, PgClientLive } from "@feeblo/db";
import { Layer, ManagedRuntime } from "effect";

const authRuntime = ManagedRuntime.make(
  DBLive.pipe(Layer.provide(PgClientLive))
);

export const auth = authRuntime.runSync(initAuthHandler());
