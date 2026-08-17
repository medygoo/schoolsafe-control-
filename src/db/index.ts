import { PostgresDatabase } from "./postgres.js";
import { SqliteDatabase } from "./sqlite.js";
import type { ControlDatabase } from "./types.js";

export type { ControlDatabase, Instance, CardPrintRequest, CreateInstanceInput, CreateCardPrintRequestInput } from "./types.js";

export function createDatabase(url?: string): ControlDatabase {
  const dsn = url || process.env.DATABASE_URL || "";
  if (dsn.startsWith("postgres") || dsn.startsWith("postgresql")) {
    return new PostgresDatabase(dsn);
  }
  const sqlitePath = dsn || process.env.DATA_DIR || "./data/control-app.db";
  return new SqliteDatabase(sqlitePath);
}
