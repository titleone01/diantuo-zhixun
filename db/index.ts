import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

type DatabaseBindings = typeof env & { DB?: D1Database };

export function getDb() {
  const bindings = env as DatabaseBindings;
  if (!bindings.DB) {
    throw new Error(
      "Cloudflare D1 binding DB is unavailable. Start the local Worker with wrangler.jsonc and apply db/migrations."
    );
  }

  return drizzle(bindings.DB, { schema });
}
