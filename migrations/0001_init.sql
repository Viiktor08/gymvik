-- Esquema inicial de Gymvik (spec §4 y §6).
--
-- Convenciones:
--  * Columnas en snake_case.
--  * Fechas y horas son texto ISO 8601 en UTC (2026-11-09T18:30:00.000Z).
--  * local_date es YYYY-MM-DD en la zona horaria del usuario.
--  * Los booleanos son INTEGER 0 o 1.
--  * Las columnas con lista (transports, scopes) guardan un array JSON.
--  * rate_limits.window_start son segundos Unix.

-- Biblioteca de ejercicios. Los ejercicios usados en el historial no se borran, se archivan.
CREATE TABLE exercises (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('strength', 'cardio', 'core', 'power', 'mobility', 'feet')),
  muscle TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  media_url TEXT CHECK (media_url IS NULL OR media_url LIKE 'https://%'),
  is_custom INTEGER NOT NULL DEFAULT 0 CHECK (is_custom IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1))
);

-- Rutinas: plantillas reutilizables, algunas en rotación.
CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  in_rotation INTEGER NOT NULL DEFAULT 0 CHECK (in_rotation IN (0, 1)),
  rotation_order INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE routine_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL REFERENCES routines (id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises (id),
  position INTEGER NOT NULL,
  sets INTEGER NOT NULL DEFAULT 3,
  reps_target TEXT NOT NULL DEFAULT '10',
  rest_seconds INTEGER NOT NULL DEFAULT 90
);

-- Entrenos. El id lo genera el cliente para que el envío sea idempotente.
-- Si se borra la rutina de origen, el entreno se conserva como entreno libre.
CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  routine_id TEXT REFERENCES routines (id) ON DELETE SET NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  local_date TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'live' CHECK (source IN ('live', 'manual'))
);

CREATE INDEX idx_workouts_local_date ON workouts (local_date);

CREATE TABLE workout_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id TEXT NOT NULL REFERENCES workouts (id) ON DELETE CASCADE,
  exercise_id TEXT NOT NULL REFERENCES exercises (id),
  position INTEGER NOT NULL
);

CREATE INDEX idx_workout_exercises_exercise_id ON workout_exercises (exercise_id);

-- Series de fuerza (weight_kg y reps) o de cardio (duration_min y distance_km).
CREATE TABLE sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_exercise_id INTEGER NOT NULL REFERENCES workout_exercises (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  weight_kg REAL,
  reps INTEGER,
  rir INTEGER,
  duration_min REAL,
  distance_km REAL
);

-- Peso y grasa corporal: solo entrada manual.
CREATE TABLE body_metrics (
  local_date TEXT PRIMARY KEY,
  weight_kg REAL NOT NULL,
  body_fat_pct REAL
);

-- Pasos del día, enviados por el Atajo de iOS.
CREATE TABLE daily_steps (
  local_date TEXT PRIMARY KEY,
  steps INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE creatine_logs (
  local_date TEXT PRIMARY KEY,
  grams REAL NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('nfc', 'manual'))
);

-- Ajustes: una única fila. Los avisos (spec §6) van en columnas planas notify_<tipo>_enabled y notify_<tipo>_time.
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  display_name TEXT NOT NULL DEFAULT 'Victor',
  theme TEXT NOT NULL DEFAULT 'green',
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  weekly_goal INTEGER NOT NULL DEFAULT 3,
  steps_goal INTEGER NOT NULL DEFAULT 8000,
  creatine_grams REAL NOT NULL DEFAULT 5,
  shortcut_name TEXT NOT NULL DEFAULT 'Gymvik Pasos',
  notify_today_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notify_today_enabled IN (0, 1)),
  notify_today_time TEXT NOT NULL DEFAULT '09:00',
  notify_creatine_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notify_creatine_enabled IN (0, 1)),
  notify_creatine_time TEXT NOT NULL DEFAULT '10:00',
  notify_steps_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notify_steps_enabled IN (0, 1)),
  notify_steps_time TEXT NOT NULL DEFAULT '20:00',
  notify_streak_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notify_streak_enabled IN (0, 1)),
  notify_streak_time TEXT NOT NULL DEFAULT '19:00',
  notify_weight_enabled INTEGER NOT NULL DEFAULT 1 CHECK (notify_weight_enabled IN (0, 1)),
  notify_weight_time TEXT NOT NULL DEFAULT '09:00'
);

INSERT INTO settings (id) VALUES (1);

-- Acceso. Los tokens, claves y códigos se guardan solo como hash SHA-256.
CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  label TEXT NOT NULL DEFAULT ''
);

CREATE TABLE auth_challenges (
  challenge TEXT PRIMARY KEY,
  purpose TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE recovery_codes (
  code_hash TEXT PRIMARY KEY,
  used_at TEXT
);

-- Claves de los Atajos de iOS y NFC. scopes es un array JSON con creatine y steps.
CREATE TABLE hook_keys (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at TEXT,
  revoked_at TEXT
);

-- Notificaciones push.
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE notifications_sent (
  type TEXT NOT NULL CHECK (type IN ('today', 'creatine', 'steps', 'streak', 'weight')),
  local_date TEXT NOT NULL,
  PRIMARY KEY (type, local_date)
);

CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);
