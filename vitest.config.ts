import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

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
              bindings: { TEST_MIGRATIONS: await readD1Migrations("./migrations") },
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
        test: {
          name: "web",
          environment: "jsdom",
          include: ["test/shared/**/*.test.{ts,tsx}", "test/web/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
