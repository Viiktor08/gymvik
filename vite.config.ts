import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// La versión instalada que enseñan los Ajustes sale de package.json en cada compilación.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  plugins: [react(), cloudflare()],
  define: { __APP_VERSION__: JSON.stringify(version) },
});
