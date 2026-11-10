import type { Routine, RoutineItem } from "../../shared/types";

type RoutineRow = {
  id: string;
  name: string;
  in_rotation: number;
  rotation_order: number;
  archived: number;
};

type ItemRow = {
  routine_id: string;
  exercise_id: string;
  position: number;
  sets: number;
  reps_target: string;
  rest_seconds: number;
};

const ROUTINE_COLUMNS = "id, name, in_rotation, rotation_order, archived";
const ITEM_COLUMNS = "routine_id, exercise_id, position, sets, reps_target, rest_seconds";

// Orden de la lista: por rotation_order y, a igualdad, por orden de creación (rowid).
const ROUTINE_ORDER = "ORDER BY rotation_order, rowid";
const ITEM_ORDER = "ORDER BY position, id";

function toItem(row: ItemRow): RoutineItem {
  return {
    exerciseId: row.exercise_id,
    position: row.position,
    sets: row.sets,
    repsTarget: row.reps_target,
    restSeconds: row.rest_seconds,
  };
}

/** Une cada rutina con sus ítems, conservando el orden de `routines`. `items` ya viene ordenado. */
function assemble(routines: RoutineRow[], items: ItemRow[]): Routine[] {
  const byRoutine = new Map<string, RoutineItem[]>();
  for (const row of items) {
    const list = byRoutine.get(row.routine_id) ?? [];
    list.push(toItem(row));
    byRoutine.set(row.routine_id, list);
  }
  return routines.map((row) => ({
    id: row.id,
    name: row.name,
    inRotation: row.in_rotation === 1,
    rotationOrder: row.rotation_order,
    archived: row.archived === 1,
    items: byRoutine.get(row.id) ?? [],
  }));
}

/** Las rutinas con sus ítems, en orden de rotación. Las archivadas solo si se piden. */
export async function listRoutines(db: D1Database, includeArchived = false): Promise<Routine[]> {
  const routineWhere = includeArchived ? "" : "WHERE archived = 0";
  const itemWhere = includeArchived ? "" : "WHERE routine_id IN (SELECT id FROM routines WHERE archived = 0)";
  const [routines, items] = await db.batch([
    db.prepare(`SELECT ${ROUTINE_COLUMNS} FROM routines ${routineWhere} ${ROUTINE_ORDER}`),
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM routine_items ${itemWhere} ${ITEM_ORDER}`),
  ]);
  return assemble((routines?.results ?? []) as RoutineRow[], (items?.results ?? []) as ItemRow[]);
}

/** La rutina, archivada o no, o null si no existe. */
export async function findRoutine(db: D1Database, id: string): Promise<Routine | null> {
  const [routines, items] = await db.batch([
    db.prepare(`SELECT ${ROUTINE_COLUMNS} FROM routines WHERE id = ?`).bind(id),
    db.prepare(`SELECT ${ITEM_COLUMNS} FROM routine_items WHERE routine_id = ? ${ITEM_ORDER}`).bind(id),
  ]);
  return assemble((routines?.results ?? []) as RoutineRow[], (items?.results ?? []) as ItemRow[])[0] ?? null;
}

export async function routineExists(db: D1Database, id: string): Promise<boolean> {
  return (await db.prepare("SELECT 1 AS found FROM routines WHERE id = ?").bind(id).first()) !== null;
}

/** Si existen todas las rutinas (archivadas o no). `ids` no debe llevar repetidos. */
export async function routinesExist(db: D1Database, ids: string[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM routines WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .first<{ n: number }>();
  return row?.n === ids.length;
}

function insertItemStatements(db: D1Database, routine: Routine): D1PreparedStatement[] {
  return routine.items.map((item) =>
    db
      .prepare(`INSERT INTO routine_items (${ITEM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(routine.id, item.exerciseId, item.position, item.sets, item.repsTarget, item.restSeconds),
  );
}

/** Crea la rutina y sus ítems en un único lote atómico. */
export async function insertRoutine(db: D1Database, routine: Routine): Promise<void> {
  await db.batch([
    db
      .prepare("INSERT INTO routines (id, name, in_rotation, rotation_order, archived) VALUES (?, ?, ?, ?, ?)")
      .bind(routine.id, routine.name, routine.inRotation ? 1 : 0, routine.rotationOrder, routine.archived ? 1 : 0),
    ...insertItemStatements(db, routine),
  ]);
}

/** Reemplaza la rutina entera, ítems incluidos, en un único lote atómico: o queda todo o no cambia nada. */
export async function replaceRoutine(db: D1Database, routine: Routine): Promise<void> {
  await db.batch([
    db
      .prepare("UPDATE routines SET name = ?, in_rotation = ?, rotation_order = ?, archived = ? WHERE id = ?")
      .bind(routine.name, routine.inRotation ? 1 : 0, routine.rotationOrder, routine.archived ? 1 : 0, routine.id),
    db.prepare("DELETE FROM routine_items WHERE routine_id = ?").bind(routine.id),
    ...insertItemStatements(db, routine),
  ]);
}

/** Archiva la rutina (los entrenos que salieron de ella la conservan). False si no existe. */
export async function archiveRoutine(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare("UPDATE routines SET archived = 1 WHERE id = ?").bind(id).run();
  return result.meta.changes === 1;
}

/** Reescribe `rotation_order` de las rutinas indicadas: 0 para la primera, 1 para la segunda, etc. */
export async function reorderRoutines(db: D1Database, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.batch(
    ids.map((id, index) => db.prepare("UPDATE routines SET rotation_order = ? WHERE id = ?").bind(index, id)),
  );
}
