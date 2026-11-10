import { readFileSync } from "node:fs";
import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// La versión instalada que enseñan los Ajustes sale de package.json en cada compilación.
const { version } = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };

export default defineConfig({
  plugins: [
    react(),
    cloudflare(),
    VitePWA({
      // El service worker lo escribimos nosotros (src/web/sw.ts): precaché, avisos push y actualización a petición.
      strategies: "injectManifest",
      srcDir: "src/web",
      filename: "sw.ts",
      // La app lo registra desde su propio código (src/web/pwa.ts), sin script inline por la CSP.
      injectRegister: false,
      registerType: "prompt",
      // Los iconos ya entran en el precaché por el patrón de abajo; así no salen dos veces.
      includeManifestIcons: false,
      manifest: {
        name: "Gymvik",
        short_name: "Gymvik",
        description: "Tus entrenos de gimnasio, siempre a mano.",
        lang: "es",
        display: "standalone",
        start_url: "/",
        scope: "/",
        // El color por tema lo pone la meta theme-color; el manifiesto lleva el verde por defecto.
        theme_color: "#1b7a4b",
        background_color: "#1b7a4b",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      injectManifest: {
        // El esqueleto de la app: HTML, JS (incluidos los trozos perezosos de las gráficas), CSS e iconos. El
        // manifiesto lo añade el plugin por su cuenta.
        globPatterns: ["**/*.{html,js,css,png,svg}"],
        // Un service worker clásico (no módulo): lo entienden todos los iOS que admiten push en PWA.
        rollupFormat: "iife",
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(version) },
});
