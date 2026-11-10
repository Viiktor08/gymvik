import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Claves VAPID de prueba: un par P-256 nuevo en cada ejecución, que no se guarda en ningún sitio y no
// corresponde a ningún servicio real. Hace falta que sean válidas porque los tests de sendPush firman con
// WebCrypto de verdad. Formato de producción: pública = punto sin comprimir (65 bytes) y privada = el
// escalar `d` (32 bytes), ambas en base64url.
function testVapidKeys(): { publicKey: string; privateKey: string } {
  const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
  const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
  return { publicKey: point.toString("base64url"), privateKey: jwk.d! };
}

const vapid = testVapidKeys();

const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

// Vitest 4+ ya no admite vitest.workspace.ts: los proyectos se declaran aquí.
// Se mantiene separado de vite.config.ts para que los tests no arranquen el
// plugin de Vite de Cloudflare.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // Las migraciones se leen en Node y llegan al Worker como un binding de prueba.
              // test/worker/apply-migrations.ts las aplica a la D1 local antes de cada archivo de tests.
              // SETUP_TOKEN y VAPID_* son valores de prueba: los secretos reales solo viven en wrangler secret y .dev.vars.
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                SETUP_TOKEN: "token-de-prueba-solo-para-tests",
                VAPID_PUBLIC_KEY: vapid.publicKey,
                VAPID_PRIVATE_KEY: vapid.privateKey,
                VAPID_SUBJECT: "mailto:pruebas@example.com",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["./test/worker/apply-migrations.ts"],
        },
      },
      {
        // JSX automático (el mismo que usa tsconfig.web.json) para poder probar componentes.
        oxc: { jsx: { runtime: "automatic" } },
        // La misma constante que inyecta vite.config.ts.
        define: { __APP_VERSION__: JSON.stringify(version) },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["test/shared/**/*.test.{ts,tsx}", "test/web/**/*.test.{ts,tsx}"],
          setupFiles: ["./test/web/setup.ts"],
        },
      },
    ],
  },
});
