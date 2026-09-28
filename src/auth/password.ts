import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
const derive = (
  password: string,
  salt: Buffer,
  length: number,
  parameters: typeof options,
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, length, parameters, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );
const options = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const weak = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "password123",
  "azertyui",
  "azertyuiop",
  "qwertyui",
  "qwertyuiop",
]);
export const passwordSchema = z
  .string()
  .min(8)
  .max(512)
  .refine(
    (value) => !weak.has(value.toLowerCase()) && !/^(.)\1+$/su.test(value),
    "Mot de passe trop faible.",
  );
export async function hashPassword(password: string): Promise<string> {
  passwordSchema.parse(password);
  const salt = randomBytes(16);
  const hash = (await derive(password, salt, 64, options)) as Buffer;
  return [
    "scrypt",
    salt.toString("base64url"),
    hash.toString("base64url"),
  ].join("$");
}
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 512
  )
    return false;
  const parts = storedHash.split("$");
  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt" ||
    parts[1].length !== 22 ||
    parts[2].length !== 86
  )
    return false;
  const salt = Buffer.from(parts[1], "base64url"),
    expected = Buffer.from(parts[2], "base64url");
  if (
    salt.length !== 16 ||
    expected.length !== 64 ||
    salt.toString("base64url") !== parts[1] ||
    expected.toString("base64url") !== parts[2]
  )
    return false;
  const actual = (await derive(password, salt, 64, options)) as Buffer;
  return timingSafeEqual(actual, expected);
}
