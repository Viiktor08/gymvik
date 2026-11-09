// Siembra la biblioteca de ejercicios en la D1 local o en la remota.
//
//   npm run seed:local     (usa .wrangler/state, hay que haber aplicado las migraciones antes)
//   npm run seed:remote    (base de datos real de Cloudflare)
//
// Genera un SQL con INSERT OR IGNORE a partir de SEED_EXERCISES y lo ejecuta con
// `wrangler d1 execute`. Es idempotente: repetirlo no duplica ni pisa ediciones.
// Se ejecuta con Node directamente (quita los tipos al cargar), por eso los imports
// de código llevan extensión .ts.
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SEED_EXERCISES } from "../src/worker/seed/exercises.ts";

const DATABASE_NAME = "gymvik";

const target = process.argv[2];
if (target !== "--local" && target !== "--remote") {
  console.error("Uso: node scripts/seed.ts --local | --remote");
  process.exit(1);
}

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

const sql = SEED_EXERCISES.map(
  ({ id, name, category, muscle, description }) =>
    `INSERT OR IGNORE INTO exercises (id, name, category, muscle, description, is_custom, archived) VALUES (${[id, name, category, muscle, description].map(quote).join(", ")}, 0, 0);`,
).join("\n");

// El SQL temporal vive fuera del repositorio y se borra siempre al terminar.
const tempDir = mkdtempSync(join(tmpdir(), "gymvik-seed-"));
const sqlFile = join(tempDir, "seed.sql");
try {
  writeFileSync(sqlFile, `${sql}\n`);
  execFileSync("npx", ["wrangler", "d1", "execute", DATABASE_NAME, target, "--file", sqlFile], {
    cwd: join(import.meta.dirname, ".."),
    stdio: "inherit",
  });
  console.log(`Ejercicios sembrados (${SEED_EXERCISES.length}) en la base de datos ${target.slice(2)}.`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
