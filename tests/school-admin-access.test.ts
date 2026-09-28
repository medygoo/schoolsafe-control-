import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import type SQLite from "better-sqlite3";
import { buildApp } from "../src/app.js";
import { SqliteDatabase } from "../src/db/sqlite.js";
import { PostgresDatabase } from "../src/db/postgres.js";
import type { ControlDatabase } from "../src/db/types.js";
const admin = "qa-admin-token-not-production";
const secret = "qa-bootstrap-secret-not-production";
const password = "Qa-school-Access!2026";
const headers = { "x-admin-token": admin };
const bootstrap = { "x-schoolsafe-bootstrap-secret": secret };
const enabled = process.env.CONTROL_PG17_QUALIFY === "1";
for (const engine of ["sqlite", ...(enabled ? ["postgres"] : [])]) {
  describe("School admin access " + engine, () => {
    let db: ControlDatabase;
    let app: Awaited<ReturnType<typeof buildApp>>;
    let pgAdmin: pg.Client | undefined;
    let database: string;
    beforeEach(async () => {
      vi.stubEnv("SCHOOLSAFE_BOOTSTRAP_SECRET", secret);
      if (engine === "sqlite") db = new SqliteDatabase(":memory:");
      else {
        database = "control_access_" + randomUUID().replaceAll("-", "");
        pgAdmin = new pg.Client({ database: "postgres" });
        await pgAdmin.connect();
        expect(
          Number(
            (await pgAdmin.query("SHOW server_version_num")).rows[0]
              .server_version_num,
          ),
        ).toBe(170011);
        await pgAdmin.query('CREATE DATABASE "' + database + '"');
        const url = new URL("postgresql://127.0.0.1");
        url.hostname = process.env.PGHOST!;
        url.port = process.env.PGPORT!;
        url.username = process.env.PGUSER!;
        url.password = process.env.PGPASSWORD!;
        url.pathname = database;
        db = new PostgresDatabase(url.toString());
      }
      await db.init();
      app = await buildApp({ db, adminToken: admin });
    });
    afterEach(async () => {
      await app?.close();
      await db?.close();
      if (pgAdmin) {
        await pgAdmin.query('DROP DATABASE "' + database + '"');
        await pgAdmin.end();
      }
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });
    const create = (payload: Record<string, unknown> = {}) =>
      app.inject({
        method: "POST",
        url: "/school-admin-access",
        headers,
        payload: {
          display_name: "QA Admin",
          email: "qa-admin-access@schoolsafe.test",
          password,
          ...payload,
        },
      });
    const verify = (
      login = "qa-admin-access@schoolsafe.test",
      pass = password,
    ) =>
      app.inject({
        method: "POST",
        url: "/internal/school-admin-access/verify",
        headers: bootstrap,
        payload: { login, password: pass },
      });
    const action = (
      id: string,
      name: string,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method: "POST",
        url: "/school-admin-access/" + id + "/" + name,
        headers,
        payload,
      });
    for (const identity of [
      { email: " QA-Admin-Access@SchoolSafe.test " },
      { email: null, phone: "0891234567" },
      { email: "qa-admin-access@schoolsafe.test", phone: "243891234567" },
    ])
      it(
        "creates and verifies identity " + JSON.stringify(identity),
        async () => {
          const r = await create(identity);
          expect(r.statusCode).toBe(201);
          expect(r.json().data).toMatchObject({
            status: "active",
            onboarding_state: "pending",
            school_id: null,
          });
          for (const login of [
            identity.email?.trim().toLowerCase(),
            identity.phone ? "+243891234567" : null,
          ].filter(Boolean)) {
            const v = await verify(login!);
            expect(v.statusCode).toBe(200);
            expect(v.json().data.onboarding_required).toBe(true);
          }
          expect(r.body).not.toMatch(/password|scrypt[$]/);
          const list = await app.inject({
            method: "GET",
            url: "/school-admin-access",
            headers,
          });
          expect(list.statusCode).toBe(200);
          expect(list.body).not.toMatch(/password|scrypt[$]/);
        },
      );
    it("rejects duplicate email and phone including concurrent creation", async () => {
      const a = await create({ phone: "0891234567" });
      expect(a.statusCode).toBe(201);
      expect(
        (await create({ email: "QA-ADMIN-ACCESS@SCHOOLSAFE.TEST" })).statusCode,
      ).toBe(409);
      expect(
        (
          await create({
            email: "other@schoolsafe.test",
            phone: "+243891234567",
          })
        ).statusCode,
      ).toBe(409);
      const both = await Promise.all([
        create({ email: "race@schoolsafe.test" }),
        create({ email: "race@schoolsafe.test" }),
      ]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    });
    for (const weak of [
      "12345678",
      "123456789",
      "1234567890",
      "password",
      "password123",
      "azertyui",
      "azertyuiop",
      "qwertyui",
      "qwertyuiop",
      "aaaaaaaaa",
      "short",
      "x".repeat(513),
    ]) {
      it("rejects weak password " + weak.slice(0, 20), async () => {
        expect((await create({ password: weak })).statusCode).toBe(400);
      });
    }
    it("rejects missing identity and invalid formats", async () => {
      for (const payload of [
        { email: null },
        { email: "invalid" },
        { email: null, phone: "123" },
        { email: null, phone: "+33891234567" },
      ])
        expect((await create(payload)).statusCode).toBe(400);
    });
    it("requires existing admin authentication", async () => {
      expect(
        (await app.inject({ method: "GET", url: "/school-admin-access" }))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/school-admin-access",
            payload: {},
          })
        ).statusCode,
      ).toBe(401);
    });
    it("executes the entire lifecycle and records secret-free audit", async () => {
      const r = await create();
      expect(r.statusCode).toBe(201);
      const id = r.json().data.id;
      expect((await verify()).statusCode).toBe(200);
      expect((await verify(undefined, "Wrong-Password!")).statusCode).toBe(401);
      expect((await verify("missing@schoolsafe.test")).json().code).toBe(
        "AUTH_INVALID",
      );
      expect((await action(id, "suspend")).statusCode).toBe(200);
      expect((await verify()).json().code).toBe("ACCESS_SUSPENDED");
      expect((await action(id, "reactivate")).statusCode).toBe(200);
      expect((await verify()).statusCode).toBe(200);
      expect(
        (await action(id, "reset-password", { password: "New-Password!2026" }))
          .statusCode,
      ).toBe(200);
      expect((await verify()).statusCode).toBe(401);
      expect((await verify(undefined, "New-Password!2026")).statusCode).toBe(
        200,
      );
      const school = randomUUID();
      const bind = (school_id: string) =>
        app.inject({
          method: "POST",
          url: "/internal/school-admin-access/" + id + "/bind-school",
          headers: bootstrap,
          payload: { school_id },
        });
      expect((await bind(school)).statusCode).toBe(200);
      expect((await bind(school)).statusCode).toBe(200);
      const conflict = await bind(randomUUID());
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json().code).toBe("SCHOOL_BIND_CONFLICT");
      expect(
        (await verify(undefined, "New-Password!2026")).json().data,
      ).toMatchObject({ school_id: school, onboarding_required: false });
      expect((await action(id, "revoke")).statusCode).toBe(200);
      const revoked = await verify(undefined, "New-Password!2026");
      expect(revoked.statusCode).toBe(403);
      expect(revoked.json().code).toBe("ACCESS_REVOKED");
      expect((await action(id, "reactivate")).statusCode).toBe(409);
      const record = await db.getSchoolAdminAccessById(id);
      expect(record?.status).toBe("revoked");
      expect(record?.password_hash).toMatch(/^scrypt[$]/);
      expect(record?.password_hash).not.toContain(password);
      const events = await db.getSchoolAdminAccessEvents(id);
      expect(events.map((e) => e.event_type)).toEqual([
        "created",
        "suspended",
        "reactivated",
        "password_reset",
        "school_bound",
        "revoked",
      ]);
      expect(JSON.stringify(events)).not.toMatch(
        /password_hash|New-Password|scrypt[$]/,
      );
    });
    it("fails closed for bootstrap secret while health stays available", async () => {
      await create();
      const request = {
        method: "POST" as const,
        url: "/internal/school-admin-access/verify",
        payload: { login: "qa-admin-access@schoolsafe.test", password },
      };
      const invalid = await app.inject({
        ...request,
        headers: { "x-schoolsafe-bootstrap-secret": "invalid" },
      });
      expect(invalid.statusCode).toBe(401);
      await app.close();
      vi.stubEnv("SCHOOLSAFE_BOOTSTRAP_SECRET", "");
      app = await buildApp({ db, adminToken: admin });
      expect(
        (await app.inject({ ...request, headers: bootstrap })).statusCode,
      ).toBe(503);
      expect(
        (await app.inject({ method: "GET", url: "/health" })).statusCode,
      ).toBe(200);
    });


    it("exposes verified canonical identities without hashes", async()=>{
      expect((await create({phone:"0891234567"})).statusCode).toBe(201);
      const result=await verify();
      expect(result.json().data).toMatchObject({email:"qa-admin-access@schoolsafe.test",phone:"+243891234567"});
      expect(result.body).not.toContain("password");
    });
    it("protects status and reports active, suspended and revoked",async()=>{
      const id=(await create()).json().data.id;
      const url="/internal/school-admin-access/"+id+"/status";
      const status=()=>app.inject({method:"GET",url,headers:bootstrap});
      expect((await app.inject({method:"GET",url})).statusCode).toBe(401);
      expect((await app.inject({method:"GET",url,headers:{"x-schoolsafe-bootstrap-secret":"wrong"}})).statusCode).toBe(401);
      for(const state of ["active","suspended","revoked"]) {
        if(state==="suspended") await action(id,"suspend");
        if(state==="revoked") await action(id,"revoke");
        const result=await status(); expect(result.statusCode).toBe(200);
        expect(result.json().data).toEqual({access_id:id,status:state,school_id:null});
        expect(result.body).not.toMatch(/password|scrypt/); expect(result.body).not.toContain(secret);
      }
      await app.close(); vi.stubEnv("SCHOOLSAFE_BOOTSTRAP_SECRET","");
      app=await buildApp({db,adminToken:admin});
      expect((await status()).statusCode).toBe(503);
    });
    it("rolls back writes when the audit insert fails", async () => {
      const id = (await create()).json().data.id;
      let rawPg: pg.Client | undefined;
      try {
        if (engine === "sqlite") {
          const raw = (db as unknown as { db: SQLite.Database }).db;
          raw.exec("CREATE TRIGGER fail_access_audit BEFORE INSERT ON school_admin_access_events BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END;");
        } else {
          rawPg = new pg.Client({ database });
          await rawPg.connect();
          await rawPg.query(
            "CREATE FUNCTION fail_access_audit() RETURNS trigger LANGUAGE plpgsql AS $audit$ BEGIN RAISE EXCEPTION 'forced audit failure'; END $audit$; CREATE TRIGGER fail_access_audit BEFORE INSERT ON school_admin_access_events FOR EACH ROW EXECUTE FUNCTION fail_access_audit();"
          );
        }
        expect((await action(id, "suspend")).statusCode).toBe(503);
        expect((await db.getSchoolAdminAccessById(id))?.status).toBe("active");
        expect((await create({ email: "rollback@schoolsafe.test" })).statusCode).toBe(503);
        expect(await db.getSchoolAdminAccessByLogin("rollback@schoolsafe.test")).toBeUndefined();
        expect((await db.getSchoolAdminAccessEvents(id)).map(event => event.event_type)).toEqual(["created"]);
      } finally {
        await rawPg?.end();
      }
    });
    it("refuses invalid transitions and binding for suspended/revoked accounts", async () => {
      const created = await create();
      const id = created.json().data.id;
      expect((await action(id, "reactivate")).statusCode).toBe(409);
      expect((await action(id, "suspend")).statusCode).toBe(200);
      expect((await action(id, "suspend")).statusCode).toBe(409);
      const bind = () =>
        app.inject({
          method: "POST",
          url: "/internal/school-admin-access/" + id + "/bind-school",
          headers: bootstrap,
          payload: { school_id: randomUUID() },
        });
      expect((await bind()).statusCode).toBe(403);
      expect((await action(id, "revoke")).statusCode).toBe(200);
      expect((await bind()).statusCode).toBe(403);
      expect(
        (
          await action(id, "reset-password", {
            password: "Another-Password!2026",
          })
        ).statusCode,
      ).toBe(409);
      expect((await action(randomUUID(), "suspend")).statusCode).toBe(404);
      expect((await verify(undefined, "wrong-password")).json().code).toBe(
        "AUTH_INVALID",
      );
    });
    it("serializes competing school bindings and state changes", async () => {
      const id = (await create()).json().data.id;
      const bind = (school_id: string) =>
        app.inject({
          method: "POST",
          url: "/internal/school-admin-access/" + id + "/bind-school",
          headers: bootstrap,
          payload: { school_id },
        });
      const bindings = await Promise.all([
        bind(randomUUID()),
        bind(randomUUID()),
      ]);
      expect(bindings.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      const suspends = await Promise.all([
        action(id, "suspend"),
        action(id, "suspend"),
      ]);
      expect(suspends.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(
        (await db.getSchoolAdminAccessEvents(id)).map((e) => e.event_type),
      ).toEqual(["created", "school_bound", "suspended"]);
    });
    it("enforces bootstrap auth on binding and never discloses hash", async () => {
      const id = (await create()).json().data.id;
      const response = await app.inject({
        method: "POST",
        url: "/internal/school-admin-access/" + id + "/bind-school",
        payload: { school_id: randomUUID() },
      });
      expect(response.statusCode).toBe(401);
      const reset = await action(id, "reset-password", {
        password: "Another-Password!2026",
      });
      expect(reset.statusCode).toBe(200);
      expect(reset.body).not.toMatch(
        /password_hash|scrypt[$]|Another-Password/,
      );
    });
    it("does not leak database error details through logs or responses", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(db, "getSchoolAdminAccesses").mockRejectedValue(
        new Error("secret-" + password),
      );
      const r = await app.inject({
        method: "GET",
        url: "/school-admin-access",
        headers,
      });
      expect(r.statusCode).toBe(500);
      expect(r.body + JSON.stringify(log.mock.calls)).not.toContain(password);
    });
    it("runs the QA lifecycle over a real local HTTP listener", async () => {
      const address = await app.listen({ host: "127.0.0.1", port: 0 });
      const request = async (
        path: string,
        body: Record<string, unknown> = {},
        internal = false,
      ) => {
        const response = await fetch(address + path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(internal ? bootstrap : headers),
          },
          body: JSON.stringify(body),
        });
        return { status: response.status, data: await response.json() };
      };
      const c = await request("/school-admin-access", {
        display_name: "Admin QA",
        email: "qa-admin-access@schoolsafe.test",
        password,
      });
      expect(c.status).toBe(201);
      const id = c.data.data.id;
      const v = (pass = password) =>
        request(
          "/internal/school-admin-access/verify",
          { login: "qa-admin-access@schoolsafe.test", password: pass },
          true,
        );
      expect((await v()).data.data.onboarding_required).toBe(true);
      expect(
        (await request("/school-admin-access/" + id + "/suspend")).status,
      ).toBe(200);
      expect((await v()).status).toBe(403);
      expect(
        (await request("/school-admin-access/" + id + "/reactivate")).status,
      ).toBe(200);
      expect((await v()).status).toBe(200);
      expect(
        (
          await request("/school-admin-access/" + id + "/reset-password", {
            password: "QA-New-Password!2026",
          })
        ).status,
      ).toBe(200);
      expect((await v()).status).toBe(401);
      expect((await v("QA-New-Password!2026")).status).toBe(200);
      expect(
        (
          await request(
            "/internal/school-admin-access/" + id + "/bind-school",
            { school_id: randomUUID() },
            true,
          )
        ).status,
      ).toBe(200);
      expect(
        (await v("QA-New-Password!2026")).data.data.onboarding_required,
      ).toBe(false);
      expect(
        (await request("/school-admin-access/" + id + "/revoke")).status,
      ).toBe(200);
      expect((await v("QA-New-Password!2026")).status).toBe(403);
    });

    it("does not leak passwords or bootstrap secrets in responses or logs", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const r = await create();
      const v = await verify();
      for (const text of [r.body, v.body, JSON.stringify(log.mock.calls)]) {
        expect(text).not.toContain(password);
        expect(text).not.toContain(secret);
        expect(text).not.toContain("password_hash");
      }
    });
  });
}
