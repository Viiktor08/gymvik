# Gymvik — Documento de diseño

> Nombre del proyecto: **Gymvik**.
> Fecha: 2026-11-09 · Autor: Victor (con Claude) · Estado: aprobado en conversación, pendiente de revisión escrita.

## 1. Objetivo

App personal de entrenamiento de gimnasio **para un único usuario** (Victor), instalable en iPhone como PWA. Inspirada en la funcionalidad de la web Yulift, pero con diseño, código, textos y biblioteca de ejercicios propios: **no se copia nada de Yulift** (ni código, ni textos, ni animaciones, ni marca).

Éxito = Victor la usa a diario para: ver qué entreno le toca, registrar el entreno serie a serie en el gimnasio (aunque no haya cobertura), ver su progreso, marcar la creatina con una pegatina NFC, sincronizar pasos con un Atajo de iOS, apuntar su peso a mano y recibir avisos útiles.

### Dentro
Pantalla Hoy (saludo, fecha, racha, te toca hoy, pasos, peso, creatina, semana), rutinas creadas a mano reutilizables y en rotación, sesión de entreno en directo con ajustes puntuales, historial, biblioteca de ejercicios, progreso (peso, semana, ejercicios y récords), creatina por NFC, pasos por Atajo de iOS, peso y % de grasa a mano, notificaciones push, registro manual de entrenos pasados, temas de color, passkeys (Face ID), exportar/importar JSON.

### Fuera
Agua, comida/macros, movilidad, plan generado con IA, tests periódicos tipo "sesión T", varios usuarios e invitaciones, peso/grasa desde la app Salud.

## 2. Decisiones clave

| Tema | Decisión |
|---|---|
| Usuarios | Uno solo. Sin registro público. |
| Plataforma | PWA instalada en iPhone (iOS ≥ 16.4 para push). |
| Stack | React + TypeScript (Vite) en el front; Hono en Cloudflare Workers; Cloudflare D1 (SQLite). Un solo proyecto y un solo despliegue: el Worker sirve la app estática y la API. |
| Código | Repositorio en GitHub. Identificadores de código en inglés; textos de la interfaz en español de España. |
| Zona horaria | Todos los "días" y "semanas" se calculan en `Europe/Madrid` (configurable en ajustes). La semana empieza el **lunes**. |
| Unidades | kg, km, minutos. Los campos numéricos aceptan coma decimal ("57,5"). |

## 3. Arquitectura

```
iPhone (PWA instalada)
  ├─ App React ─────────────► /api/*        (cookie de sesión, passkey)
  ├─ Atajos iOS / NFC ──────► /api/hook/*   (clave Bearer, solo escritura)
  └─ Notificaciones push ◄─── Worker: tarea programada cada 15 min
                                   │
                              Cloudflare D1
```

- **Entreno sin cobertura:** la sesión en curso vive en el móvil (IndexedDB) y se envía al terminar con un id generado en el cliente. El envío es idempotente (`PUT /api/workouts/:id`) y se reintenta desde una cola local cuando vuelve la conexión. La app abre sin conexión gracias a la caché del service worker.
- **Lógica de dominio en funciones puras** compartidas (`src/shared`): rotación, racha, resumen semanal, récords, 1RM, diferencias de rutina, prerrelleno de series y condiciones de los avisos. Todo lo derivado (récords, rachas, resúmenes) **se calcula**, no se guarda.

## 4. Modelo de datos (D1)

| Tabla | Campos principales |
|---|---|
| `exercises` | id, name, category (`strength`·`cardio`·`core`·`power`·`mobility`·`feet`), muscle, description, media_url (https, opcional), is_custom, archived |
| `routines` | id, name, in_rotation, rotation_order, archived, created_at |
| `routine_items` | id, routine_id, exercise_id, position, sets, reps_target (texto: "8-10", "12", "20 min"), rest_seconds |
| `workouts` | id (uuid del cliente), routine_id (nullable), started_at, ended_at (UTC ISO), local_date (YYYY-MM-DD en la zona del usuario), notes, source (`live`·`manual`) |
| `workout_exercises` | id, workout_id, exercise_id, position |
| `sets` | id, workout_exercise_id, position, weight_kg, reps, rir (nullable), duration_min, distance_km (cardio) |
| `body_metrics` | local_date (PK), weight_kg, body_fat_pct (nullable) — **solo entrada manual** |
| `daily_steps` | local_date (PK), steps, updated_at — desde el Atajo |
| `creatine_logs` | local_date (PK), grams, source (`nfc`·`manual`) |
| `settings` | fila única: display_name, theme, timezone, weekly_goal, steps_goal, creatine_grams, shortcut_name, notificaciones (enabled + hora por tipo) |
| `passkeys` | credential_id, public_key, counter, transports, created_at, label |
| `auth_challenges` | challenge, purpose, expires_at (5 min) |
| `sessions` | token_hash, created_at, last_seen_at, expires_at |
| `recovery_codes` | code_hash, used_at |
| `hook_keys` | id, label, key_hash, scopes (`creatine`, `steps`), created_at, last_used_at, revoked_at |
| `push_subscriptions` | endpoint, p256dh, auth, created_at |
| `notifications_sent` | type, local_date (PK compuesta) |
| `rate_limits` | bucket, window_start, count |

Los ejercicios usados en el historial no se borran: se **archivan** (desaparecen de la biblioteca y de los selectores, pero el historial sigue mostrándolos).

## 5. Pantallas y flujos

Navegación inferior: **Hoy · Entreno · Progreso**. Ajustes con icono arriba a la derecha.

### 5.1 Hoy
- Saludo ("Hola, Victor"), fecha y **racha en semanas**.
- **Te toca hoy:** siguiente rutina de la rotación con sus ejercicios y duración estimada; botón **Empezar** y enlace "Hacer otra" para elegir cualquier rutina o un entreno libre. Sin rutinas en rotación: tarjeta que invita a crear una.
- **Pasos:** hoy frente al objetivo y botón "Sincronizar" que abre el Atajo de Salud (`shortcuts://run-shortcut?name=<nombre>`) y vuelve a la app.
- **Peso:** último registro y tendencia de la semana, y botón **"Apuntar peso"** (peso y % de grasa opcional) en una hoja rápida.
- **Creatina:** tomada o no hoy; se marca con NFC o tocando la tarjeta (y se desmarca tocando otra vez).
- **Semana de lunes a domingo:** días con entreno marcados y contador "N/objetivo". **Si se supera el objetivo se muestra tal cual (por ejemplo 4/3) y la semana cuenta como cumplida.**
- Si hay una sesión en curso guardada en el móvil: banner **"Tienes un entreno en curso · Continuar"**.

### 5.2 Entreno
- Botones **Entreno libre** y **Nueva rutina**.
- **En rotación:** rutinas ordenadas, con la etiqueta SIGUIENTE en la que toca; cada una con Empezar y Editar.
- **Otras rutinas:** las que no están en rotación (se pueden empezar cualquier día).
- Accesos a **Historial** y **Biblioteca**.

**Rotación:** las rutinas son plantillas reutilizables. Las marcadas "en rotación" tienen un orden; "te toca" es la siguiente a la **última rutina en rotación que se completó**, de forma circular. Hacer una rutina fuera de orden, una que no rota o un entreno libre no rompe la rotación: solo cuenta el último entreno de una rutina que siga en rotación. Sin historial, toca la primera.

**Editor de rutina:** nombre, interruptor "En rotación", y ejercicios con series, objetivo de repeticiones (texto libre, por ejemplo "8-10") y descanso en segundos. Se reordenan (subir/bajar), se quitan y se añaden desde la biblioteca con buscador.

### 5.3 Sesión en directo
- Cabecera: cronómetro total, botón **Terminar** y menú con **Descartar** (con confirmación).
- Tarjeta por ejercicio:
  - Debajo del nombre: **"Última vez: 60×10 · 60×9 · 57,5×8"** (la última sesión en la que se hizo ese ejercicio).
  - Las series vienen **prerrellenadas**: con los valores de la última vez; si la plantilla pide más series de las que hubo, se repite la última; si nunca se hizo, peso vacío y repeticiones = límite inferior del objetivo.
  - Marcar ✓ completa la serie y arranca el **temporizador de descanso** (cuenta atrás visible con los segundos de la rutina, 90 s por defecto; botones Saltar y +15 s; aviso sonoro con la app abierta).
  - RIR opcional, plegado por defecto.
  - Menú ⋯: añadir serie, quitar serie, **cambiar por otro ejercicio**, quitar ejercicio, subir y bajar.
- **Cardio:** cada fila es minutos y distancia (km, opcional). El "tipo de cardio" es el propio ejercicio (Correr, Bici, Remo…).
- **Añadir ejercicio** al final.
- **Terminar:** resumen con duración, volumen total (Σ peso×reps), número de series, minutos y km de cardio, **récords nuevos 🏆** y un campo para notas. Si cambió la **estructura** (ejercicios, su orden o el número de series) respecto a la rutina de origen, pregunta: **"¿Guardar estos cambios en la rutina o solo para hoy?"**. Los cambios de peso y repeticiones no cuentan como cambio de estructura.
- Al guardar los cambios en la rutina: los ejercicios y el número de series pasan a la rutina; se conservan el objetivo y el descanso de los ejercicios que ya estaban; los nuevos usan 3 series, "10" repeticiones y 90 s.
- Solo cuentan para estadísticas las series marcadas ✓.

### 5.4 Historial
Entrenos por fecha (nombre, duración y volumen). El detalle permite editar series y notas o borrar el entreno. **Registro manual de un entreno pasado:** fecha, rutina (o libre), duración y, opcionalmente, series.

### 5.5 Biblioteca
Buscador, filtros por categoría y botón para crear ejercicio. La ficha muestra la descripción, la imagen (si hay `media_url` de imagen) o un enlace al vídeo, **tu historial de ese ejercicio** y su gráfica. Viene con unos 60 ejercicios comunes con **descripciones propias**, todos editables y archivables.

### 5.6 Progreso
- **Peso:** gráfica del peso con media móvil de 7 días y % de grasa, con rangos de 4 semanas, 12 semanas o todo.
- **Semana:** semana actual frente a la anterior: entrenos (N/objetivo), volumen, minutos y km de cardio, pasos medios y días con creatina. Racha de semanas cumplidas.
- **Ejercicios:** selector de ejercicio y gráfica del peso máximo y del **1RM estimado (Epley: peso × (1 + reps/30); con 1 repetición, el propio peso)** por sesión.
  - Récords de fuerza: mayor peso, mejor 1RM estimado y mayor volumen en una sesión.
  - Récords de cardio: mayor distancia y mejor ritmo (min/km).
- Sin datos se muestra "Sin datos todavía"; **nunca valores como Infinity o NaN**.

**Racha:** número de semanas consecutivas (lunes a domingo) con entrenos ≥ objetivo semanal, contando hacia atrás desde la última semana cerrada. La semana actual suma 1 en cuanto se cumple. Una semana actual sin cumplir no rompe la racha hasta que termina. Se usa el objetivo vigente para todas las semanas.

### 5.7 Ajustes
- Cuenta: passkeys (añadir dispositivo, ver y quitar), regenerar códigos de recuperación y cerrar sesión.
- Tema: 8 colores (verde, azul, morado, rojo, naranja, rosa, turquesa y grafito); modo claro u oscuro según el sistema.
- Objetivos: entrenos por semana (define la racha), pasos y gramos de creatina.
- **Atajos y NFC:** crear, ver y revocar claves con permisos; URLs para copiar; **guía paso a paso** para montar los atajos; nombre exacto del Atajo de Salud.
- **Notificaciones:** activar (pide permiso), interruptor y hora por aviso, y "Enviar aviso de prueba".
- **Peso manual:** fecha, peso y % de grasa (también disponible desde Hoy).
- **Entreno pasado** (ver 5.4).
- App: versión instalada y "Actualizar".
- Datos: **Exportar JSON** e **Importar JSON** (sustituye todos los datos tras confirmación; no incluye passkeys, sesiones ni claves).

## 6. Notificaciones

Push web con VAPID. La tarea programada del Worker se ejecuta cada 15 minutos. Un aviso se envía si: está activado, la hora local ≥ su hora configurada, no se ha enviado hoy (`notifications_sent`) y se cumple su condición. Al pulsarlo se abre la ruta indicada.

| Tipo | Hora por defecto | Condición | Texto de ejemplo | Abre |
|---|---|---|---|---|
| `today` | 09:00 | Hoy no hay entreno | "Hoy toca Pecho (6 ejercicios)" | `/` |
| `creatine` | 10:00 | Hoy no hay creatina | "¿Creatina? Aún no la has marcado hoy" | `/` |
| `steps` | 20:00 | Pasos de hoy < objetivo (sin datos = 0) | "Llevas 4.210 de 8.000 pasos" | `/` |
| `streak` | 19:00 | Faltan entrenos para cumplir la semana y entrenos que faltan ≥ días que quedan (incluido hoy) | "Te faltan 2 entrenos y quedan 2 días para mantener 5 semanas 🔥" | `/entreno` |
| `weight` | 09:00 | Sin peso registrado en los últimos 7 días | "Hace una semana que no apuntas tu peso" | `/?peso=1` |

Si una suscripción devuelve 404 o 410, se borra. Requisito en iPhone: app añadida a la pantalla de inicio (iOS ≥ 16.4) y permiso pedido desde un botón.

## 7. Atajos de iOS y NFC

- `POST /api/hook/creatine` — permiso `creatine`. Cuerpo opcional `{ "grams": número }` (por defecto los gramos de ajustes). Marca la creatina de hoy. **Idempotente:** si ya estaba marcada, responde `{"message":"Ya estaba marcada"}` sin duplicar. Si no, `{"message":"Creatina ✓ 5 g"}`.
- `POST /api/hook/steps` — permiso `steps`. Cuerpo `{ "steps": entero 0–200000, "date"?: "YYYY-MM-DD" }`. Actualiza los pasos del día si ya existían. Responde `{"message":"Pasos: 8.432"}`.
- Autenticación: `Authorization: Bearer <clave>`. La respuesta incluye `message` para que el atajo lo muestre.
- Automatizaciones recomendadas (guía en la app): pegatina NFC → atajo Creatina ("ejecutar sin preguntar"); varias horas al día → atajo Pasos.

## 8. Seguridad

- **Primer acceso:** `/setup` con un token de configuración (`SETUP_TOKEN`, secreto de Wrangler). Solo funciona mientras no exista ninguna passkey. Al registrar la primera passkey se generan **8 códigos de recuperación** de un solo uso, que se muestran una vez y se guardan como hash SHA-256.
- **Login:** solo passkey (WebAuthn, verificación de usuario obligatoria). Recuperación: un código de un solo uso da una sesión y lleva directamente a registrar una passkey nueva.
- **Sesión:** cookie `__Host-session` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`). Token aleatorio de 32 bytes guardado como hash. Caduca tras 30 días sin uso (se renueva al usarla). Cerrar sesión la revoca.
- **CSRF:** en los métodos que modifican datos de `/api/*` (excepto `/api/hook/*`), la cabecera `Origin` debe ser la del propio sitio.
- **Claves de atajo:** formato `fk_` + 32 bytes aleatorios en base64url. Se muestran una sola vez y se guardan como hash SHA-256. Tienen permisos, se pueden revocar, registran el último uso y **solo dan acceso a `/api/hook/*`**.
- **Límites de peticiones:** login, recuperación y setup, 10 por minuto por IP; hooks, 30 por minuto por clave. Si se superan, 429.
- **Validación:** zod en todas las entradas y consultas parametrizadas (`prepare().bind()`).
- **Cabeceras:** CSP (`default-src 'self'; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`), `Strict-Transport-Security`, `X-Content-Type-Options: nosniff` y `Referrer-Policy: same-origin`.
- **Secretos:** `SETUP_TOKEN`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` y `VAPID_SUBJECT` con `wrangler secret`. Nunca en el repositorio.
- **Copias:** exportar e importar JSON, más la restauración a un momento anterior de D1 (Time Travel; la retención depende del plan).

## 9. Pruebas y despliegue

- Tests unitarios (Vitest) de toda la lógica de `src/shared`.
- Tests de integración de la API con `@cloudflare/vitest-pool-workers` (Worker y D1 locales).
- CI en GitHub Actions: typecheck y tests en cada push.
- Despliegue con `wrangler deploy` desde el Mac. Base de datos con migraciones de D1.
- Verificación final en el iPhone con una lista de comprobación (instalación, passkey, sesión sin cobertura, NFC, atajo, push).
