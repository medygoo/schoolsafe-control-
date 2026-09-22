import { PostgresDatabase } from "./postgres.js";
import { SqliteDatabase } from "./sqlite.js";
import type { ControlDatabase } from "./types.js";

export type { ControlDatabase, Instance, CardPrintRequest, CreateInstanceInput, CreateCardPrintRequestInput, LicenseRecord, CreateLicenseInput } from "./types.js";

const PRODUCTION_DATABASE_ERROR = "PostgreSQL database configuration is required";

function validPostgresDsn(dsn: string): boolean {
  try {
    const parsed = new URL(dsn);
    return (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:")
      && parsed.hostname.length > 0
      && parsed.pathname.length > 1;
  } catch {
    return false;
  }
}

export function createDatabase(url?: string, nodeEnv = process.env.NODE_ENV): ControlDatabase {
  const dsn = url ?? process.env.DATABASE_URL ?? "";
  if (validPostgresDsn(dsn)) {
    return new PostgresDatabase(dsn);
  }
  if (nodeEnv === "production") {
    throw new Error(PRODUCTION_DATABASE_ERROR);
  }
  if (dsn.startsWith("sqlite:") && dsn.length > "sqlite:".length) {
    return new SqliteDatabase(dsn.slice("sqlite:".length));
  }
  throw new Error("Explicit PostgreSQL or SQLite database configuration is required");
}
