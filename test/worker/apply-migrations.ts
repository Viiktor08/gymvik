import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Se ejecuta antes de cada archivo de tests del proyecto `worker` (setupFiles).
// Es idempotente: solo aplica las migraciones que falten en la D1 local.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
