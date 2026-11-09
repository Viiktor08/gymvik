import { describe, expect, it } from "vitest";
import { addDays } from "../../src/shared/dates";
import { dueNotifications, type NotificationState } from "../../src/shared/notifications";
import type { NotificationType, Settings } from "../../src/shared/types";

// Ajustes por defecto de la spec §6: horas de los avisos, objetivo de 3 entrenos y 8.000 pasos.
const SETTINGS: Settings = {
  displayName: "Victor",
  theme: "green",
  timezone: "Europe/Madrid",
  weeklyGoal: 3,
  stepsGoal: 8000,
  creatineGrams: 5,
  shortcutName: "Pasos",
  notifications: {
    today: { enabled: true, time: "09:00" },
    creatine: { enabled: true, time: "10:00" },
    steps: { enabled: true, time: "20:00" },
    streak: { enabled: true, time: "19:00" },
    weight: { enabled: true, time: "09:00" },
  },
};

// Noviembre: Madrid va en horario de invierno (UTC+1). Lunes 9, viernes 13, sábado 14, domingo 15.
const MONDAY = "2026-11-09";
const FRIDAY = "2026-11-13";
const SATURDAY = "2026-11-14";
const SUNDAY = "2026-11-15";

function madrid(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+01:00`);
}

function state(over: Partial<NotificationState> = {}): NotificationState {
  return {
    now: madrid(MONDAY, "09:00"),
    settings: SETTINGS,
    sentToday: new Set(),
    workoutDates: [],
    next: { name: "Pecho", exerciseCount: 6 },
    creatineToday: false,
    stepsToday: null,
    lastWeightDate: null,
    ...over,
  };
}

function withSettings(
  patch: Partial<Record<NotificationType, { enabled?: boolean; time?: string }>>,
  base: Partial<Settings> = {},
): Settings {
  const notifications = { ...SETTINGS.notifications };
  for (const [type, value] of Object.entries(patch) as [NotificationType, { enabled?: boolean; time?: string }][]) {
    notifications[type] = { ...notifications[type], ...value };
  }
  return { ...SETTINGS, ...base, notifications };
}

function types(s: NotificationState): NotificationType[] {
  return dueNotifications(s).map((m) => m.type);
}

function find(s: NotificationState, type: NotificationType) {
  return dueNotifications(s).find((m) => m.type === type);
}

// `n` entrenos en días distintos desde `monday`.
function inWeek(monday: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(monday, i));
}

describe("dueNotifications: hora y estado general", () => {
  it("a las 08:59 sin nada hecho no hay avisos", () => {
    expect(dueNotifications(state({ now: madrid(MONDAY, "08:59") }))).toEqual([]);
  });

  it("a las 09:00 salen today y weight (nunca se ha apuntado peso)", () => {
    const due = dueNotifications(state());
    expect(due.map((m) => m.type)).toEqual(["today", "weight"]);
    expect(due[0]).toEqual({ type: "today", title: "Gymvik", body: "Hoy toca Pecho (6 ejercicios)", url: "/" });
    expect(due[1]).toEqual({
      type: "weight",
      title: "Gymvik",
      body: "Hace una semana que no apuntas tu peso",
      url: "/?peso=1",
    });
  });

  it("la hora se mira en la zona del usuario, también en horario de verano", () => {
    // 15 de julio: Madrid va en UTC+2. 06:59Z son las 08:59 locales; 07:00Z, las 09:00.
    const july = { settings: SETTINGS, workoutDates: [] as string[] };
    expect(dueNotifications(state({ ...july, now: new Date("2026-07-15T06:59:00Z") }))).toEqual([]);
    expect(types(state({ ...july, now: new Date("2026-07-15T07:00:00Z") }))).toEqual(["today", "weight"]);
  });

  it("usa la zona de los ajustes, no la del servidor", () => {
    // 08:00Z son las 09:00 en Madrid pero las 04:00 en Nueva York.
    const newYork = { ...SETTINGS, timezone: "America/New_York" };
    expect(dueNotifications(state({ now: madrid(MONDAY, "09:00"), settings: newYork }))).toEqual([]);
  });

  it("un aviso pasada su hora sigue pendiente hasta que se envía (la tarea corre cada 15 min)", () => {
    expect(types(state({ now: madrid(MONDAY, "23:45") }))).toEqual(["today", "creatine", "steps", "weight"]);
  });

  it("respeta la hora configurada de cada aviso", () => {
    const settings = withSettings({ today: { time: "07:30" } });
    expect(types(state({ settings, now: madrid(MONDAY, "07:29") }))).toEqual([]);
    expect(types(state({ settings, now: madrid(MONDAY, "07:30") }))).toEqual(["today"]);
  });

  it("a las 10:00 se suma creatine", () => {
    const due = dueNotifications(state({ now: madrid(MONDAY, "10:00") }));
    expect(due.map((m) => m.type)).toEqual(["today", "creatine", "weight"]);
    expect(due[1]).toEqual({
      type: "creatine",
      title: "Gymvik",
      body: "¿Creatina? Aún no la has marcado hoy",
      url: "/",
    });
  });

  it("un aviso desactivado nunca se envía", () => {
    const all: NotificationType[] = ["today", "creatine", "steps", "streak", "weight"];
    const settings = withSettings(Object.fromEntries(all.map((t) => [t, { enabled: false }])));
    const now = madrid(SATURDAY, "23:00");
    expect(dueNotifications(state({ settings, now, workoutDates: [MONDAY] }))).toEqual([]);
  });

  it("desactivar un aviso no afecta a los demás", () => {
    const settings = withSettings({ today: { enabled: false } });
    expect(types(state({ settings }))).toEqual(["weight"]);
  });

  it("no repite un aviso que ya se envió hoy", () => {
    expect(types(state({ sentToday: new Set<NotificationType>(["today"]) }))).toEqual(["weight"]);
    expect(types(state({ sentToday: new Set<NotificationType>(["today", "weight"]) }))).toEqual([]);
  });
});

describe("dueNotifications: today", () => {
  it("no sale si ya hay un entreno hoy", () => {
    expect(types(state({ workoutDates: [MONDAY] }))).toEqual(["weight"]);
  });

  it("un entreno de otro día no lo evita", () => {
    expect(types(state({ workoutDates: ["2026-11-08", "2026-11-10"] }))).toEqual(["today", "weight"]);
  });

  it("el día del entreno se mide en la zona local, no en UTC", () => {
    // 00:30 del martes en Madrid sigue siendo lunes 23:30 en UTC.
    const now = madrid("2026-11-10", "09:00");
    expect(types(state({ now, workoutDates: ["2026-11-10"] }))).toEqual(["weight"]);
    expect(types(state({ now, workoutDates: ["2026-11-09"] }))).toEqual(["today", "weight"]);
  });

  it("no sale si no hay rutina siguiente", () => {
    expect(types(state({ next: null }))).toEqual(["weight"]);
  });

  it("usa el singular con un solo ejercicio", () => {
    expect(find(state({ next: { name: "Espalda", exerciseCount: 1 } }), "today")?.body).toBe(
      "Hoy toca Espalda (1 ejercicio)",
    );
  });

  it("usa el nombre de la rutina y el número de ejercicios", () => {
    expect(find(state({ next: { name: "Pierna", exerciseCount: 8 } }), "today")?.body).toBe(
      "Hoy toca Pierna (8 ejercicios)",
    );
  });
});

describe("dueNotifications: creatine", () => {
  const now = madrid(MONDAY, "10:00");

  it("no sale si hoy ya se marcó la creatina", () => {
    expect(types(state({ now, creatineToday: true }))).toEqual(["today", "weight"]);
  });

  it("no se repite si ya se envió hoy", () => {
    expect(types(state({ now, sentToday: new Set<NotificationType>(["creatine"]) }))).toEqual(["today", "weight"]);
  });
});

describe("dueNotifications: steps", () => {
  const now = madrid(MONDAY, "20:00");
  const quiet = { creatineToday: true, workoutDates: [MONDAY], lastWeightDate: MONDAY };

  it("a las 20:00 con 4210 pasos el cuerpo lleva separador de miles", () => {
    expect(dueNotifications(state({ ...quiet, now, stepsToday: 4210 }))).toEqual([
      { type: "steps", title: "Gymvik", body: "Llevas 4.210 de 8.000 pasos", url: "/" },
    ]);
  });

  it("con 9000 pasos no hay steps", () => {
    expect(types(state({ ...quiet, now, stepsToday: 9000 }))).toEqual([]);
  });

  it("con exactamente el objetivo tampoco", () => {
    expect(types(state({ ...quiet, now, stepsToday: 8000 }))).toEqual([]);
  });

  it("un pasito por debajo del objetivo sí", () => {
    expect(find(state({ ...quiet, now, stepsToday: 7999 }), "steps")?.body).toBe("Llevas 7.999 de 8.000 pasos");
  });

  it("sin datos cuenta como 0 pasos", () => {
    expect(find(state({ ...quiet, now, stepsToday: null }), "steps")?.body).toBe("Llevas 0 de 8.000 pasos");
  });

  it("no sale antes de su hora", () => {
    expect(types(state({ ...quiet, now: madrid(MONDAY, "19:59"), stepsToday: 100 }))).toEqual([]);
  });

  it("usa el objetivo de pasos de los ajustes", () => {
    const settings = withSettings({}, { stepsGoal: 12500 });
    expect(find(state({ ...quiet, now, settings, stepsToday: 1000 }), "steps")?.body).toBe(
      "Llevas 1.000 de 12.500 pasos",
    );
  });
});

describe("dueNotifications: streak", () => {
  // La semana del 9 al 15 de noviembre. Objetivo 3.
  const quiet = { creatineToday: true, stepsToday: 9000, lastWeightDate: MONDAY, next: null };
  const previousWeeks = (n: number) =>
    Array.from({ length: n }, (_, i) => inWeek(addDays(MONDAY, -7 * (i + 1)), 3)).flat();

  it("sábado a las 19:00 con 1 entreno y objetivo 3: faltan 2 y quedan 2 días", () => {
    const due = dueNotifications(
      state({ ...quiet, now: madrid(SATURDAY, "19:00"), workoutDates: [MONDAY], sentToday: new Set(["today"]) }),
    );
    expect(due).toEqual([
      {
        type: "streak",
        title: "Gymvik",
        body: "Te faltan 2 entrenos y quedan 2 días para cumplir la semana",
        url: "/entreno",
      },
    ]);
  });

  it("viernes a las 19:00 con 1 entreno: faltan 2 pero quedan 3 días, no sale", () => {
    expect(types(state({ ...quiet, now: madrid(FRIDAY, "19:00"), workoutDates: [MONDAY] }))).toEqual([]);
  });

  it("no sale antes de las 19:00", () => {
    expect(types(state({ ...quiet, now: madrid(SATURDAY, "18:59"), workoutDates: [MONDAY] }))).toEqual([]);
  });

  it("con racha de 5 semanas menciona la racha y el fuego", () => {
    const workoutDates = [MONDAY, ...previousWeeks(5)];
    expect(find(state({ ...quiet, now: madrid(SATURDAY, "19:00"), workoutDates }), "streak")?.body).toBe(
      "Te faltan 2 entrenos y quedan 2 días para mantener 5 semanas 🔥",
    );
  });

  it("con racha de 1 semana usa el singular", () => {
    const workoutDates = [MONDAY, ...previousWeeks(1)];
    expect(find(state({ ...quiet, now: madrid(SATURDAY, "19:00"), workoutDates }), "streak")?.body).toBe(
      "Te faltan 2 entrenos y quedan 2 días para mantener 1 semana 🔥",
    );
  });

  it("el domingo con 2 entrenos: te falta 1 y queda 1 día", () => {
    const workoutDates = [MONDAY, addDays(MONDAY, 1), ...previousWeeks(2)];
    expect(find(state({ ...quiet, now: madrid(SUNDAY, "19:00"), workoutDates }), "streak")?.body).toBe(
      "Te falta 1 entreno y queda 1 día para mantener 2 semanas 🔥",
    );
  });

  it("el domingo con 1 entreno: te faltan 2 y queda 1 día", () => {
    expect(find(state({ ...quiet, now: madrid(SUNDAY, "19:00"), workoutDates: [MONDAY] }), "streak")?.body).toBe(
      "Te faltan 2 entrenos y queda 1 día para cumplir la semana",
    );
  });

  it("si la semana ya está cumplida no sale (ni con más entrenos que el objetivo)", () => {
    expect(types(state({ ...quiet, now: madrid(SUNDAY, "19:00"), workoutDates: inWeek(MONDAY, 3) }))).toEqual([]);
    expect(types(state({ ...quiet, now: madrid(SUNDAY, "19:00"), workoutDates: inWeek(MONDAY, 4) }))).toEqual([]);
  });

  it("los entrenos de la semana anterior no cuentan para faltan, solo para la racha", () => {
    const workoutDates = previousWeeks(1);
    expect(find(state({ ...quiet, now: madrid(SATURDAY, "19:00"), workoutDates }), "streak")?.body).toBe(
      "Te faltan 3 entrenos y quedan 2 días para mantener 1 semana 🔥",
    );
  });

  it("no sale si ya se envió hoy", () => {
    const s = state({
      ...quiet,
      now: madrid(SATURDAY, "19:00"),
      workoutDates: [MONDAY],
      sentToday: new Set<NotificationType>(["streak"]),
    });
    expect(types(s)).toEqual([]);
  });

  it("usa el objetivo semanal de los ajustes", () => {
    const settings = withSettings({}, { weeklyGoal: 5 });
    // Lunes con 2 entrenos y objetivo 5: faltan 3; el viernes quedan 3.
    const workoutDates = [MONDAY, addDays(MONDAY, 1)];
    expect(find(state({ ...quiet, settings, now: madrid(FRIDAY, "19:00"), workoutDates }), "streak")?.body).toBe(
      "Te faltan 3 entrenos y quedan 3 días para cumplir la semana",
    );
  });
});

describe("dueNotifications: weight", () => {
  const quiet = { creatineToday: true, workoutDates: [MONDAY], next: null };

  it("peso apuntado hace 6 días: no hay weight", () => {
    expect(types(state({ ...quiet, lastWeightDate: "2026-11-03" }))).toEqual([]);
  });

  it("peso apuntado hace 7 días: sí", () => {
    expect(types(state({ ...quiet, lastWeightDate: "2026-11-02" }))).toEqual(["weight"]);
  });

  it("peso apuntado hace mucho: sí", () => {
    expect(types(state({ ...quiet, lastWeightDate: "2026-01-15" }))).toEqual(["weight"]);
  });

  it("peso apuntado hoy: no", () => {
    expect(types(state({ ...quiet, lastWeightDate: MONDAY }))).toEqual([]);
  });

  it("no depende del mes: hace 7 días cruzando fin de mes", () => {
    const now = madrid("2026-12-02", "09:00");
    expect(types(state({ ...quiet, now, workoutDates: ["2026-12-02"], lastWeightDate: "2026-11-25" }))).toEqual([
      "weight",
    ]);
    expect(types(state({ ...quiet, now, workoutDates: ["2026-12-02"], lastWeightDate: "2026-11-26" }))).toEqual([]);
  });
});
