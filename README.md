# Gymvik

App personal de entrenamiento de gimnasio para un único usuario, instalable en iPhone como PWA.

- Front: React + TypeScript (Vite).
- Back: Hono en un único Cloudflare Worker, que sirve también la app estática.
- Datos: Cloudflare D1 (SQLite).

El diseño completo está en [`docs/superpowers/specs/2026-11-09-gymvik-design.md`](docs/superpowers/specs/2026-11-09-gymvik-design.md) y el plan de implementación en [`docs/superpowers/plans/2026-11-09-gymvik.md`](docs/superpowers/plans/2026-11-09-gymvik.md).

## Requisitos

Node `^22.22.2 || ^24.15.0 || >=26` (lo exigen Vitest 5, jsdom 31, Wrangler 4 y Vite 8). La CI usa Node 24.

## Instalación y desarrollo

```sh
npm install
cp .dev.vars.example .dev.vars   # y rellena los valores (ver "Secretos")
npx wrangler d1 migrations apply gymvik --local
npm run seed:local               # biblioteca de ejercicios en la D1 local
npm run dev
```

La app queda en http://localhost:5173 y la API en `/api/*` (por ejemplo `/api/health`). La D1 local vive en `.wrangler/state` (ignorado por git).

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
| `node scripts/vapid.ts --put` / `--print` | Genera un par de claves VAPID y lo guarda como secretos de Cloudflare (`--put`) o lo imprime para `.dev.vars` (`--print`). Ver "Secretos". |

## PWA

`npm run build` genera `dist/client/sw.js` (service worker: precaché de la app, avisos push y actualización a petición) y `manifest.webmanifest` con vite-plugin-pwa. El service worker solo se registra en la versión compilada: para probar el modo sin conexión, los avisos o Ajustes → Actualizar hay que usar `npm run build && npm run preview`, no `npm run dev`.

## Estructura

```
migrations/   Migraciones de D1 (esquema y ajustes por defecto)
scripts/      Scripts de mantenimiento (semilla de ejercicios, iconos, claves VAPID)
src/worker/   Worker (Hono): API y tarea programada
src/web/      App React
src/shared/   Lógica de dominio pura, compartida por Worker y web
test/worker/  Tests de integración de la API (runtime de Workers)
test/web/     Tests de componentes (jsdom)
test/shared/  Tests de la lógica compartida (jsdom)
```

## Despliegue

Gymvik corre en un único Worker de Cloudflare (que sirve también la app estática) con una base D1. Sin dominio propio: se usa `workers.dev`. Requisitos: una cuenta de Cloudflare con un subdominio `workers.dev` y `npx wrangler login` hecho.

Solo la primera vez:

```sh
npx wrangler d1 create gymvik                       # copia el database_id en wrangler.jsonc (no es un secreto)
npx wrangler d1 migrations apply gymvik --remote    # esquema y ajustes por defecto
npm run seed:remote                                 # 63 ejercicios (idempotente)
```

Después, los secretos (ver más abajo) y, en cada despliegue:

```sh
npm run build && npx wrangler deploy
```

`wrangler deploy` también registra el cron de avisos (`*/15 * * * *`). Una migración nueva se aplica a mano con `npx wrangler d1 migrations apply gymvik --remote` antes de desplegar el código que la usa.

Para comprobar un despliegue sin iniciar sesión:

```sh
curl -i https://<tu-worker>.<tu-subdominio>.workers.dev/api/health      # 200 {"ok":true}
curl -s https://<tu-worker>.<tu-subdominio>.workers.dev/api/auth/me     # {"authenticated":false,"setupRequired":true} mientras no haya passkey
```

Primer arranque: abre `https://<url>/setup?token=<SETUP_TOKEN>` en Safari del iPhone, crea la passkey con Face ID y guarda los 8 códigos de recuperación. La passkey queda ligada al dominio: si cambias el subdominio de `workers.dev` hay que repetir el registro. La lista de comprobaciones en el móvil real está en [`docs/verificacion-iphone.md`](docs/verificacion-iphone.md).

## Secretos

`SETUP_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` solo viven en `.dev.vars` (ignorado por git) en local y como secretos de Cloudflare en producción. `.dev.vars.example` solo contiene marcadores. Nunca los pongas como argumento de un comando ni los versiones: `wrangler secret put <NOMBRE>` lee el valor de la entrada estándar.

| Secreto | Qué es |
|---|---|
| `SETUP_TOKEN` | Token para el primer registro de passkey; solo vale mientras no haya ninguna registrada. 32 bytes aleatorios en base64url. |
| `VAPID_PUBLIC_KEY` | Clave pública VAPID: punto P-256 sin comprimir (65 bytes) en base64url. La app la usa para suscribirse a los avisos. |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID: el escalar `d` (32 bytes) en base64url. Firma los avisos push. |
| `VAPID_SUBJECT` | Contacto del servicio push: un `mailto:` tuyo. |

Claves VAPID, con el script del repositorio (genera el par con `node:crypto`, el formato que espera `@block65/webcrypto-web-push`):

```sh
node scripts/vapid.ts --put      # genera el par y lo guarda en Cloudflare; solo imprime la pública
node scripts/vapid.ts --print    # imprime el par para pegarlo en .dev.vars (es la única forma de ver la privada)
```

Cambiar las claves invalida las suscripciones push existentes: hay que volver a activar los avisos en Ajustes.

El resto, a mano en producción (los valores entran por la tubería y por una variable de shell: no aparecen en el historial):

```sh
TOKEN=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
printf '%s' "$TOKEN" | npx wrangler secret put SETUP_TOKEN
printf '%s' 'mailto:tu-correo@example.com' | npx wrangler secret put VAPID_SUBJECT

# La URL de configuración, en un archivo solo legible por ti (.superpowers/ está ignorado por git):
mkdir -p .superpowers && (umask 077 && printf 'https://<url>/setup?token=%s\n' "$TOKEN" > .superpowers/setup-url.txt)
```

Cloudflare no vuelve a mostrar el valor de un secreto: si pierdes `SETUP_TOKEN`, pon uno nuevo con otro `secret put` del mismo nombre. `npx wrangler secret list` enseña los nombres, nunca los valores.
