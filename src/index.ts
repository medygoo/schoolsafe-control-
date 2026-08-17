import { buildApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { createDatabase } from "./db/index.js";

const env = parseEnv(process.env);
const db = createDatabase(env.DATABASE_URL);
await db.init();

const app = await buildApp({ db, adminToken: env.ADMIN_TOKEN });

await app.listen({ host: env.HOST, port: env.PORT });
console.log(`SchoolSafe Control App listening on http://${env.HOST}:${env.PORT}`);

process.on("SIGTERM", async () => {
  await db.close();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await db.close();
  process.exit(0);
});
