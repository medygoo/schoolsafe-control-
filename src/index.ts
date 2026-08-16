import { join } from "node:path";
import { buildApp } from "./app.js";
import { parseEnv } from "./config/env.js";
import { JsonStore } from "./store.js";

const env = parseEnv(process.env);
const store = new JsonStore(join(env.DATA_DIR, "control-app.json"));
const app = buildApp({ store, adminToken: env.ADMIN_TOKEN });

await app.listen({ host: env.HOST, port: env.PORT });
console.log(`SchoolSafe Control App listening on http://${env.HOST}:${env.PORT}`);
