import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

const applyMigrations = async (connectionString: string): Promise<void> => {
  const pool = new Pool({ connectionString });

  try {
    const database = drizzle({ client: pool });
    const migrationsFolder = fileURLToPath(new URL("./migration", import.meta.url));

    await migrate(database, { migrationsFolder });
  } finally {
    await pool.end();
  }
};

if (!connectionString) {
  console.error("Database migration failed: DATABASE_URL is not set");
  process.exitCode = 1;
} else {
  try {
    await applyMigrations(connectionString);
    console.log("Database migrations applied");
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).split("\n", 1)[0];
    console.error(`Database migration failed: ${message}`);
    process.exitCode = 1;
  }
}
