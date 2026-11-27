# Gymvik

App de entrenamiento de gimnasio que me he hecho para mí: la uso a diario en el iPhone, instalada como PWA. Es de un solo usuario, sin registro público.

<!-- Capturas: pon las imágenes en docs/capturas/ y quita este comentario.
<p align="center">
  <img src="docs/capturas/hoy.png" width="200" alt="Pantalla Hoy">
  <img src="docs/capturas/sesion.png" width="200" alt="Sesión en curso">
  <img src="docs/capturas/progreso.png" width="200" alt="Progreso">
  <img src="docs/capturas/ajustes.png" width="200" alt="Ajustes">
</p>
-->

## Qué hace

- **Hoy:** qué rutina toca según la rotación, racha en semanas, pasos, peso, creatina y la semana de lunes a domingo.
- **Rutinas y biblioteca:** rutinas propias en rotación, más de 60 ejercicios de serie y los que añadas tú (con imagen o vídeo).
- **Sesión en directo sin cobertura:** el entreno se guarda en el móvil serie a serie, con temporizador de descanso, y se sincroniza solo cuando vuelve la conexión, sin duplicados.
- **Progreso:** gráfica de peso con media de 7 días, comparación con la semana anterior y evolución y récords por ejercicio (peso máximo, 1RM estimado, volumen, distancia y ritmo).
- **Creatina con NFC y pasos desde Salud:** dos Atajos de iOS llaman a la API con claves de solo escritura; basta con acercar el móvil a una pegatina.
- **Avisos push:** recordatorios de entreno, creatina, pasos, racha y peso a la hora elegida, enviados por una tarea programada del Worker.
- **Cuenta:** acceso con passkey (Face ID), códigos de recuperación, exportar e importar todo en JSON, y temas de color.

## Stack

- **Front:** React + TypeScript (Vite), PWA con service worker (Workbox) e IndexedDB para el modo sin conexión.
- **Back:** Hono en un único Cloudflare Worker, que sirve también la app estática, más un cron cada 15 minutos para los avisos.
- **Datos:** Cloudflare D1 (SQLite).
- **Seguridad:** WebAuthn (passkeys), cookies de sesión con hash en base de datos, defensa CSRF por origen, cabeceras de seguridad y límite de peticiones por IP.
- **Push:** Web Push con cifrado aes128gcm y firma VAPID hechos con WebCrypto.
- **Tests:** Vitest, en el runtime de Workers y en jsdom, con CI en GitHub Actions.

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
| `npm run icons` | Regenera los iconos de `public/icons/` (PNG 192, 512, maskable, de iOS y favicon) a partir de `assets/icon-source.png`. Necesita Python con Pillow. Solo hace falta si cambia el icono; los PNG están versionados. |
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

Primer arranque: abre `https://<url>/setup?token=<SETUP_TOKEN>` en Safari del iPhone, crea la passkey con Face ID y guarda los 8 códigos de recuperación. La passkey queda ligada al dominio: si cambias el subdominio de `workers.dev` hay que repetir el registro.

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

# La URL de configuración, en un archivo solo legible por ti (.local/ está ignorado por git):
mkdir -p .local && (umask 077 && printf 'https://<url>/setup?token=%s\n' "$TOKEN" > .local/setup-url.txt)
```

Cloudflare no vuelve a mostrar el valor de un secreto: si pierdes `SETUP_TOKEN`, pon uno nuevo con otro `secret put` del mismo nombre. `npx wrangler secret list` enseña los nombres, nunca los valores.

