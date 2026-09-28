import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAdminToken } from "../auth/admin.js";
import { requireBootstrapSecret } from "../auth/bootstrap.js";
import {
  hashPassword,
  passwordSchema,
  verifyPassword,
} from "../auth/password.js";
import {
  SchoolAdminAccessError,
  type ControlDatabase,
  type SchoolAdminAccess,
} from "../db/types.js";
export function normalizePhone(value: string): string {
  let phone = value.trim();
  if (/^0\d{9}$/.test(phone)) phone = "+243" + phone.slice(1);
  else if (/^243\d{9}$/.test(phone)) phone = "+" + phone;
  if (!/^\+243\d{9}$/.test(phone))
    throw new SchoolAdminAccessError(
      400,
      "VALIDATION_INVALID",
      "Téléphone RDC invalide.",
    );
  return phone;
}
const email = z.string().trim().toLowerCase().email().max(254);
const createSchema = z
  .object({
    display_name: z.string().trim().min(1).max(200),
    email: email.nullish(),
    phone: z.string().max(32).transform(normalizePhone).nullish(),
    password: passwordSchema,
  })
  .refine(
    (value) => Boolean(value.email || value.phone),
    "E-mail ou téléphone requis.",
  );
function publicAccess(row: SchoolAdminAccess) {
  const { password_hash, password_changed_at, ...safe } = row;
  return safe;
}
function loginKey(login: string): string {
  try {
    return login.includes("@") ? email.parse(login) : normalizePhone(login);
  } catch {
    return "";
  }
}
export function registerSchoolAdminAccessRoutes(
  app: FastifyInstance,
  db: ControlDatabase,
  adminToken: string,
  bootstrapSecret?: string,
): void {
  app.get("/school-admin-access", async (request) => {
    requireAdminToken(request, adminToken);
    return { data: (await db.getSchoolAdminAccesses()).map(publicAccess) };
  });
  app.post("/school-admin-access", async (request, reply) => {
    requireAdminToken(request, adminToken);
    const body = createSchema.parse(request.body);
    const row = await db.createSchoolAdminAccess({
      display_name: body.display_name,
      email_normalized: body.email ?? null,
      phone_normalized: body.phone ?? null,
      password_hash: await hashPassword(body.password),
    });
    return reply.status(201).send({ data: publicAccess(row) });
  });
  for (const action of [
    "reset-password",
    "suspend",
    "reactivate",
    "revoke",
  ] as const) {
    app.post("/school-admin-access/:id/" + action, async (request) => {
      requireAdminToken(request, adminToken);
      const id = z
        .object({
          id: z
            .string()
            .uuid()
            .transform((value) => value.toLowerCase()),
        })
        .parse(request.params).id;
      const hash =
        action === "reset-password"
          ? await hashPassword(
              z.object({ password: passwordSchema }).parse(request.body)
                .password,
            )
          : undefined;
      return {
        data: publicAccess(await db.updateSchoolAdminAccess(id, action, hash)),
      };
    });
  }
  // A fixed, non-secret dummy derivation prevents an inexpensive account-existence shortcut.
  const dummyHash =
    "scrypt$" +
    Buffer.alloc(16).toString("base64url") +
    "$" +
    Buffer.alloc(64).toString("base64url");
  app.post("/internal/school-admin-access/verify", async (request) => {
    requireBootstrapSecret(request, bootstrapSecret);
    const parsed = z
      .object({ login: z.string().max(254), password: z.string().max(512) })
      .safeParse(request.body);
    if (!parsed.success)
      throw new SchoolAdminAccessError(
        401,
        "AUTH_INVALID",
        "Identifiants invalides.",
      );
    let row = await db.getSchoolAdminAccessByLogin(loginKey(parsed.data.login));
    const valid = await verifyPassword(
      parsed.data.password,
      row?.password_hash ?? dummyHash,
    );
    if (!row || !valid)
      throw new SchoolAdminAccessError(
        401,
        "AUTH_INVALID",
        "Identifiants invalides.",
      );
    const current = await db.getSchoolAdminAccessById(row.id);
    if (!current || current.password_hash !== row.password_hash)
      throw new SchoolAdminAccessError(
        401,
        "AUTH_INVALID",
        "Identifiants invalides.",
      );
    row = current;
    if (row.status !== "active")
      throw new SchoolAdminAccessError(
        403,
        row.status === "suspended" ? "ACCESS_SUSPENDED" : "ACCESS_REVOKED",
        "Accès refusé.",
      );
    return {
      data: {
        access_id: row.id,
        status: row.status,
        onboarding_required: row.school_id === null,
        school_id: row.school_id,
      },
    };
  });
  app.post("/internal/school-admin-access/:id/bind-school", async (request) => {
    requireBootstrapSecret(request, bootstrapSecret);
    const id = z
      .object({
        id: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
      })
      .parse(request.params).id;
    const { school_id } = z
      .object({
        school_id: z
          .string()
          .uuid()
          .transform((value) => value.toLowerCase()),
      })
      .parse(request.body);
    const row = await db.bindSchoolAdminAccess(id, school_id);
    return {
      data: {
        access_id: row.id,
        status: row.status,
        onboarding_required: false,
        school_id: row.school_id,
      },
    };
  });
}
