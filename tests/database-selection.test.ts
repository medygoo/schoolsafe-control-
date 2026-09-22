import { describe, expect, it } from "vitest";
import { createDatabase } from "../src/db/index.js";
import { PostgresDatabase } from "../src/db/postgres.js";
import { SqliteDatabase } from "../src/db/sqlite.js";

describe("database adapter selection", () => {
  it.each([
    [undefined, "production"],
    ["", "production"],
    ["sqlite::memory:", "production"],
    ["not-a-dsn", "production"],
    ["postgresql://", "production"],
    ["postgresql://control:secret@db.example.test/", "production"]
  ])("fails closed for %j in %s", (dsn, nodeEnv) => {
    expect(() => createDatabase(dsn, nodeEnv)).toThrow("PostgreSQL database configuration is required");
  });

  it("does not expose a rejected DSN in the configuration error", () => {
    const secretDsn = "postgresql://control:do-not-log@/control";
    expect(() => createDatabase(secretDsn, "production")).toThrowError(
      new Error("PostgreSQL database configuration is required")
    );
  });

  it("accepts a valid production PostgreSQL DSN", async () => {
    const db = createDatabase("postgresql://control:secret@db.example.test:5432/control", "production");
    expect(db).toBeInstanceOf(PostgresDatabase);
    await db.close();
  });

  it("accepts explicit in-memory SQLite in test", async () => {
    const db = createDatabase("sqlite::memory:", "test");
    expect(db).toBeInstanceOf(SqliteDatabase);
    await db.close();
  });

  it("accepts an explicit SQLite file in development", async () => {
    const db = createDatabase("sqlite::memory:", "development");
    expect(db).toBeInstanceOf(SqliteDatabase);
    await db.close();
  });
});
