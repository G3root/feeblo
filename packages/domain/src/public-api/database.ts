import { Database } from "@feeblo/db";

import { currentService } from "../current-service";

/**
 * The transaction handle comes from the context so `Database` never enters a
 * handler's requirement channel.
 */
export const currentPublicApiDatabase = currentService(Database.Database);
