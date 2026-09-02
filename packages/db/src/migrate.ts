import { migrateDb } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
const databaseSsl = process.env.DATABASE_SSL;

if (databaseUrl === undefined || databaseUrl.trim() === "") {
  console.error("DATABASE_URL is required to run database migrations.");
  process.exitCode = 1;
} else if (databaseSsl !== undefined && databaseSsl !== "true" && databaseSsl !== "false") {
  console.error("DATABASE_SSL must be true or false.");
  process.exitCode = 1;
} else {
  try {
    await migrateDb(databaseUrl, { ssl: databaseSsl === "true" });
  } catch {
    // Do not print driver errors here: connection errors can contain secrets.
    console.error("Database migrations failed.");
    process.exitCode = 1;
  }
}
