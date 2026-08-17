import { describe, it, expect } from "vitest";
import { parseEnv } from "../src/config/env.js";

describe("parseEnv", () => {
  it("preserves DATABASE_URL from the environment", () => {
    const databaseUrl = "postgresql://user:pass@example.neon.tech/schoolsafe?sslmode=require";
    const env = parseEnv({
      HOST: "0.0.0.0",
      PORT: "10000",
      DATABASE_URL: databaseUrl,
      ADMIN_TOKEN: "test-admin-token-32-chars-long"
    });

    expect(env.DATABASE_URL).toBe(databaseUrl);
  });
});
