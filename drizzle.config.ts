import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // Review-only candidate SQL. Executed migrations live exclusively in db/migrations/.
  out: "./.local/migration-candidates",
  schema: "./db/schema.ts",
  dialect: "sqlite",
});
