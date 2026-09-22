import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("../deploy/schoolsafe-control-trial-check.service", import.meta.url), "utf8");
const documentation = readFileSync(new URL("../deploy/SYSTEMD_TIMER.md", import.meta.url), "utf8");

describe("SchoolSafe Control trial scheduler", () => {
  it("loads the URL and admin token from the production environment file", () => {
    expect(service).toContain("EnvironmentFile=/etc/schoolsafe-control/env");
    expect(service).toContain("${CONTROL_API_URL}/instances/check-expired-trials");
    expect(service).toContain('x-admin-token: ${ADMIN_TOKEN}');
    expect(service).not.toContain(":-");
  });

  it("documents the same configurable URL and authentication header", () => {
    expect(documentation).toContain("CONTROL_API_URL=http://127.0.0.1:10000");
    expect(documentation).toContain('x-admin-token: ${ADMIN_TOKEN}');
    expect(documentation).not.toMatch(/Authorization\s*:\s*Bearer/i);
    expect(documentation).not.toContain("localhost:3000");
  });
});
