import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Vitest 4+ ya no admite vitest.workspace.ts: los proyectos se declaran aquí.
// Se mantiene separado de vite.config.ts para que los tests no arranquen el
// plugin de Vite de Cloudflare.
export default defineConfig({
  test: {
    projects: [
      {
        plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
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
