# Gymvik

App personal de entrenamiento de gimnasio para un único usuario, instalable en iPhone como PWA.

- Front: React + TypeScript (Vite).
- Back: Hono en un único Cloudflare Worker, que sirve también la app estática.
- Datos: Cloudflare D1 (SQLite).

El diseño completo está en [`docs/superpowers/specs/2026-11-09-gymvik-design.md`](docs/superpowers/specs/2026-11-09-gymvik-design.md) y el plan de implementación en [`docs/superpowers/plans/2026-11-09-gymvik.md`](docs/superpowers/plans/2026-11-09-gymvik.md).

## Requisitos

Node `^22.22.2 || ^24.15.0 || >=26` (lo exigen Vitest 5, jsdom 31, Wrangler 4 y Vite 8). La CI usa Node 24.

## Puesta en marcha

```sh
npm install
cp .dev.vars.example .dev.vars   # y rellena los valores
npm run dev
```

La app queda en http://localhost:5173 y la API en `/api/*` (por ejemplo `/api/health`).

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo (Vite + Worker local con D1). |
| `npm run build` | Compila el front y el Worker en `dist/`. |
| `npm test` | Tests con Vitest: proyecto `worker` (runtime de Workers) y proyecto `web` (jsdom). |
| `npm run typecheck` | Comprueba tipos del Worker (`tsconfig.json`), de la web (`tsconfig.web.json`) y del service worker (`tsconfig.sw.json`, lib de WebWorker). |
| `npm run icons` | Regenera los iconos de `public/icons/` (PNG 192, 512, maskable y de iOS, más el SVG). Solo hace falta si cambia el dibujo; los PNG están versionados. |
| `npm run types` | Regenera `worker-configuration.d.ts` tras cambiar `wrangler.jsonc` o `.dev.vars.example`. |
| `npm run seed:local` | Siembra los ejercicios de la biblioteca en la D1 local. Es idempotente. Antes: `npx wrangler d1 migrations apply gymvik --local`. |
| `npm run seed:remote` | Lo mismo en la D1 de Cloudflare (solo cuando la base remota exista y tenga las migraciones aplicadas). |

## PWA

`npm run build` genera `dist/client/sw.js` (service worker: precaché de la app, avisos push y actualización a petición) y `manifest.webmanifest` con vite-plugin-pwa. El service worker solo se registra en la versión compilada: para probar el modo sin conexión, los avisos o Ajustes → Actualizar hay que usar `npm run build && npm run preview`, no `npm run dev`.

## Estructura

```
migrations/   Migraciones de D1 (esquema y ajustes por defecto)
scripts/      Scripts de mantenimiento (semilla de ejercicios)
src/worker/   Worker (Hono): API y tarea programada
src/web/      App React
src/shared/   Lógica de dominio pura, compartida por Worker y web
test/worker/  Tests de integración de la API (runtime de Workers)
test/web/     Tests de componentes (jsdom)
test/shared/  Tests de la lógica compartida (jsdom)
```

## Secretos

`SETUP_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` solo viven en `.dev.vars` (ignorado por git) en local y en `wrangler secret put <NOMBRE>` en producción. `.dev.vars.example` solo contiene marcadores.
