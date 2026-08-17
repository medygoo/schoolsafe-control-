import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().default(4176),
  DATA_DIR: z.string().default("./data"),
  DATABASE_URL: z.string().optional(),
  ADMIN_TOKEN: z.string().min(16, "ADMIN_TOKEN doit faire au moins 16 caractères")
});

export type ControlAppEnv = z.infer<typeof envSchema>;

export function parseEnv(input: Record<string, string | undefined>): ControlAppEnv {
  const parsed = envSchema.safeParse({
    HOST: input.HOST,
    PORT: input.PORT,
    DATA_DIR: input.DATA_DIR,
    ADMIN_TOKEN: input.ADMIN_TOKEN
  });
  if (!parsed.success) {
    throw new Error(`Configuration invalide : ${parsed.error.message}`);
  }
  return parsed.data;
}
