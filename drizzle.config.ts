import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// supabase/schema.sql is the source of truth; this config is only for
// `npx drizzle-kit studio` or introspection against the same database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
