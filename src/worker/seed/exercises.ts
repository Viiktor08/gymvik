import type { Category } from "../../shared/types";

// Este archivo también lo carga scripts/seed.ts directamente con Node (sin Vite ni Wrangler),
// así que solo puede importar tipos: los imports normales no se resolverían.

export type SeedExercise = {
  id: string;
  name: string;
  category: Category;
  muscle: string;
  description: string;
};

// Ids estables tipo slug: el historial y las rutinas los referencian, así que no se renombran.
// Descripciones propias, de una frase.
export const SEED_EXERCISES: SeedExercise[] = [
  // Fuerza: piernas y cadera
  {
    id: "back_squat",
    name: "Sentadilla trasera",
    category: "strength",
    muscle: "Cuádriceps",
    description:
      "Con la barra sobre la espalda alta, baja flexionando cadera y rodillas hasta que los muslos queden paralelos al suelo y sube empujando el suelo con todo el pie.",
  },
  {
    id: "front_squat",
    name: "Sentadilla frontal",
    category: "strength",
    muscle: "Cuádriceps",
    description:
      "Con la barra apoyada en la parte delantera de los hombros y los codos altos, baja con el torso bien vertical y sube sin dejar que se te caiga el pecho.",
  },
  {
    id: "goblet_squat",
    name: "Sentadilla goblet",
    category: "strength",
    muscle: "Cuádriceps",
    description: "Sujeta una mancuerna o una pesa rusa pegada al pecho y baja en cuclillas profundas con la espalda recta.",
  },
  {
    id: "leg_press",
    name: "Prensa de piernas",
    category: "strength",
    muscle: "Cuádriceps",
    description:
      "Sentado en la máquina, flexiona las rodillas hasta acercar la plataforma al pecho y empújala de nuevo sin despegar la zona lumbar del respaldo.",
  },
  {
    id: "bulgarian_split_squat",
    name: "Sentadilla búlgara",
    category: "strength",
    muscle: "Cuádriceps",
    description:
      "Con el pie de atrás apoyado en un banco, baja en vertical sobre la pierna adelantada y sube empujando con ella.",
  },
  {
    id: "walking_lunge",
    name: "Zancadas caminando",
    category: "strength",
    muscle: "Glúteo",
    description:
      "Da un paso largo hacia delante, baja hasta que la rodilla de atrás casi roce el suelo y encadena la siguiente zancada con la otra pierna.",
  },
  {
    id: "reverse_lunge",
    name: "Zancada hacia atrás",
    category: "strength",
    muscle: "Glúteo",
    description:
      "Da un paso atrás, baja la rodilla trasera hacia el suelo y vuelve a la posición inicial empujando con la pierna adelantada.",
  },
  {
    id: "leg_extension",
    name: "Extensión de cuádriceps",
    category: "strength",
    muscle: "Cuádriceps",
    description: "Sentado en la máquina, estira las rodillas hasta extenderlas del todo y vuelve despacio a la posición inicial.",
  },
  {
    id: "lying_leg_curl",
    name: "Curl femoral tumbado",
    category: "strength",
    muscle: "Isquiotibiales",
    description: "Tumbado boca abajo en la máquina, lleva los talones hacia los glúteos flexionando las rodillas y baja con control.",
  },
  {
    id: "conventional_deadlift",
    name: "Peso muerto convencional",
    category: "strength",
    muscle: "Espalda baja",
    description:
      "Con los pies a la anchura de la cadera, agarra la barra con la espalda neutra y levántala extendiendo cadera y rodillas a la vez.",
  },
  {
    id: "sumo_deadlift",
    name: "Peso muerto sumo",
    category: "strength",
    muscle: "Glúteo",
    description:
      "Con los pies muy abiertos y las manos por dentro de las piernas, levanta la barra empujando el suelo y abriendo las rodillas.",
  },
  {
    id: "romanian_deadlift",
    name: "Peso muerto rumano",
    category: "strength",
    muscle: "Isquiotibiales",
    description:
      "Con las rodillas ligeramente flexionadas, lleva la cadera atrás para bajar la barra pegada a los muslos hasta notar tensión detrás de las piernas y vuelve a subir.",
  },
  {
    id: "hip_thrust",
    name: "Hip thrust con barra",
    category: "strength",
    muscle: "Glúteo",
    description:
      "Con la espalda alta apoyada en un banco y la barra sobre la cadera, empuja hacia arriba hasta alinear rodillas, cadera y hombros y aprieta los glúteos arriba.",
  },
  {
    id: "glute_bridge",
    name: "Puente de glúteo",
    category: "strength",
    muscle: "Glúteo",
    description: "Tumbado boca arriba con las rodillas flexionadas, eleva la cadera apretando los glúteos y baja sin descansar abajo.",
  },

  // Fuerza: empuje (pecho, hombros y tríceps) y bíceps
  {
    id: "bench_press",
    name: "Press de banca",
    category: "strength",
    muscle: "Pecho",
    description:
      "Tumbado en el banco, baja la barra hasta rozar el pecho con los codos algo cerrados y empújala hasta estirar los brazos.",
  },
  {
    id: "incline_bench_press",
    name: "Press inclinado con barra",
    category: "strength",
    muscle: "Pecho",
    description:
      "En un banco inclinado, baja la barra hasta la parte alta del pecho y empújala hacia arriba para cargar sobre todo la zona superior del pectoral.",
  },
  {
    id: "dumbbell_bench_press",
    name: "Press de banca con mancuernas",
    category: "strength",
    muscle: "Pecho",
    description:
      "Tumbado en el banco con una mancuerna en cada mano, bájalas a los lados del pecho y súbelas hasta juntarlas arriba con los brazos extendidos.",
  },
  {
    id: "incline_dumbbell_press",
    name: "Press inclinado con mancuernas",
    category: "strength",
    muscle: "Pecho",
    description:
      "En un banco inclinado, empuja las mancuernas desde los lados del pecho hasta estirar los brazos y bájalas despacio.",
  },
  {
    id: "cable_fly",
    name: "Cruces en polea",
    category: "strength",
    muscle: "Pecho",
    description:
      "De pie entre dos poleas, junta las manos delante del pecho con los codos ligeramente flexionados y ábrelas despacio hasta notar el estiramiento.",
  },
  {
    id: "push_up",
    name: "Flexiones",
    category: "strength",
    muscle: "Pecho",
    description: "Con las manos bajo los hombros y el cuerpo en línea recta, baja el pecho hasta casi tocar el suelo y empuja para subir.",
  },
  {
    id: "dip",
    name: "Fondos en paralelas",
    category: "strength",
    muscle: "Tríceps",
    description:
      "Sostenido sobre las paralelas con los brazos estirados, baja doblando los codos hasta que los hombros queden a la altura de las manos y vuelve a subir.",
  },
  {
    id: "overhead_press",
    name: "Press militar con barra",
    category: "strength",
    muscle: "Hombros",
    description: "De pie, empuja la barra desde la clavícula hasta estirar los brazos por encima de la cabeza sin arquear la zona lumbar.",
  },
  {
    id: "dumbbell_shoulder_press",
    name: "Press de hombros con mancuernas",
    category: "strength",
    muscle: "Hombros",
    description:
      "Sentado con una mancuerna en cada mano a la altura de los hombros, empújalas hacia arriba hasta extender los brazos y baja con control.",
  },
  {
    id: "lateral_raise",
    name: "Elevaciones laterales",
    category: "strength",
    muscle: "Hombros",
    description: "De pie con una mancuerna en cada mano, eleva los brazos hacia los lados hasta la altura de los hombros y baja despacio.",
  },
  {
    id: "face_pull",
    name: "Face pull",
    category: "strength",
    muscle: "Hombros",
    description:
      "Tira de la cuerda de una polea alta hacia la cara separando las manos y llevando los codos atrás para trabajar la parte trasera del hombro.",
  },
  {
    id: "triceps_pushdown",
    name: "Extensión de tríceps en polea",
    category: "strength",
    muscle: "Tríceps",
    description:
      "De pie frente a la polea alta, empuja la barra o la cuerda hacia abajo hasta estirar los codos, manteniéndolos pegados al cuerpo.",
  },
  {
    id: "skull_crusher",
    name: "Press francés",
    category: "strength",
    muscle: "Tríceps",
    description: "Tumbado en el banco con la barra sobre el pecho, flexiona solo los codos para bajarla hacia la frente y vuelve a estirar los brazos.",
  },
  {
    id: "dumbbell_curl",
    name: "Curl de bíceps con mancuernas",
    category: "strength",
    muscle: "Bíceps",
    description: "Con una mancuerna en cada mano, flexiona los codos para subirlas girando las palmas hacia arriba y baja despacio.",
  },
  {
    id: "hammer_curl",
    name: "Curl martillo",
    category: "strength",
    muscle: "Bíceps",
    description: "Con las mancuernas en agarre neutro, con las palmas mirándose entre sí, flexiona los codos para subirlas sin girar las muñecas.",
  },

  // Fuerza: tirón (remos y jalones)
  {
    id: "barbell_row",
    name: "Remo con barra",
    category: "strength",
    muscle: "Espalda",
    description: "Con el torso inclinado casi paralelo al suelo, tira de la barra hacia el abdomen juntando los omóplatos y baja con control.",
  },
  {
    id: "dumbbell_row",
    name: "Remo con mancuerna a una mano",
    category: "strength",
    muscle: "Espalda",
    description:
      "Con una mano y una rodilla apoyadas en un banco, tira de la mancuerna hacia la cadera llevando el codo atrás y baja despacio.",
  },
  {
    id: "seated_cable_row",
    name: "Remo sentado en polea",
    category: "strength",
    muscle: "Espalda",
    description: "Sentado frente a la polea baja, tira del agarre hacia el abdomen con la espalda recta y estira los brazos despacio.",
  },
  {
    id: "t_bar_row",
    name: "Remo en barra T",
    category: "strength",
    muscle: "Espalda",
    description: "Inclinado sobre la barra T, tira de ella hacia el pecho juntando los omóplatos y baja sin perder la postura.",
  },
  {
    id: "lat_pulldown",
    name: "Jalón al pecho",
    category: "strength",
    muscle: "Dorsal",
    description: "Sentado frente a la polea alta, tira de la barra hasta la parte alta del pecho llevando los codos hacia abajo y vuelve despacio.",
  },
  {
    id: "pull_up",
    name: "Dominadas",
    category: "strength",
    muscle: "Dorsal",
    description: "Colgado de la barra con las palmas hacia delante, sube hasta pasar la barbilla por encima y baja hasta estirar los brazos.",
  },
  {
    id: "chin_up",
    name: "Dominadas supinas",
    category: "strength",
    muscle: "Dorsal",
    description: "Colgado de la barra con las palmas hacia ti, sube hasta pasar la barbilla por encima, con más participación del bíceps.",
  },
  {
    id: "straight_arm_pulldown",
    name: "Jalón con brazos rectos",
    category: "strength",
    muscle: "Dorsal",
    description: "De pie frente a la polea alta, baja la barra con los brazos casi estirados hasta los muslos sintiendo el trabajo del dorsal.",
  },

  // Core
  {
    id: "plank",
    name: "Plancha",
    category: "core",
    muscle: "Abdomen",
    description: "Apoyado sobre los antebrazos y las puntas de los pies, mantén el cuerpo recto como una tabla apretando abdomen y glúteos.",
  },
  {
    id: "side_plank",
    name: "Plancha lateral",
    category: "core",
    muscle: "Oblicuos",
    description: "Apoyado sobre un antebrazo y el borde del pie, mantén el cuerpo alineado con la cadera elevada del suelo.",
  },
  {
    id: "dead_bug",
    name: "Dead bug",
    category: "core",
    muscle: "Abdomen",
    description: "Tumbado boca arriba con brazos y piernas en el aire, estira a la vez un brazo y la pierna contraria sin despegar la zona lumbar del suelo.",
  },
  {
    id: "hanging_leg_raise",
    name: "Elevación de piernas colgado",
    category: "core",
    muscle: "Abdomen",
    description: "Colgado de una barra, sube las piernas hasta la horizontal sin balancearte y bájalas despacio.",
  },
  {
    id: "cable_crunch",
    name: "Crunch en polea",
    category: "core",
    muscle: "Abdomen",
    description: "De rodillas frente a la polea alta, flexiona la columna llevando los codos hacia las rodillas y vuelve despacio.",
  },
  {
    id: "ab_wheel_rollout",
    name: "Rueda abdominal",
    category: "core",
    muscle: "Abdomen",
    description:
      "De rodillas con las manos en la rueda, ruédala hacia delante todo lo que puedas sin hundir la espalda y vuelve contrayendo el abdomen.",
  },
  {
    id: "pallof_press",
    name: "Press Pallof",
    category: "core",
    muscle: "Oblicuos",
    description: "De lado a una polea, empuja el agarre desde el pecho hacia delante y resiste el giro del torso.",
  },

  // Potencia
  {
    id: "kettlebell_swing",
    name: "Swing con pesa rusa",
    category: "power",
    muscle: "Glúteo",
    description: "Con la pesa rusa entre las piernas, lanza la cadera hacia delante con fuerza para que la pesa suba hasta la altura del pecho.",
  },
  {
    id: "box_jump",
    name: "Salto al cajón",
    category: "power",
    muscle: "Cuádriceps",
    description: "Desde una semisentadilla, salta con los dos pies sobre un cajón, aterriza suave con las rodillas flexionadas y baja caminando.",
  },
  {
    id: "power_clean",
    name: "Cargada de potencia",
    category: "power",
    muscle: "Cuerpo completo",
    description:
      "Desde el suelo, lleva la barra hasta los hombros en un único movimiento explosivo, extendiendo cadera y rodillas y recibiéndola en un cuarto de sentadilla.",
  },
  {
    id: "medicine_ball_slam",
    name: "Lanzamiento de balón medicinal al suelo",
    category: "power",
    muscle: "Cuerpo completo",
    description: "Levanta el balón medicinal sobre la cabeza y lánzalo con toda tu fuerza contra el suelo usando todo el cuerpo.",
  },
  {
    id: "broad_jump",
    name: "Salto horizontal",
    category: "power",
    muscle: "Piernas",
    description: "Con los pies a la anchura de los hombros, salta hacia delante lo más lejos posible y aterriza estable con las rodillas flexionadas.",
  },

  // Pies
  {
    id: "standing_calf_raise",
    name: "Elevación de talones de pie",
    category: "feet",
    muscle: "Gemelos",
    description: "De pie, con la punta del pie sobre un escalón o una máquina, sube los talones todo lo que puedas y baja hasta notar el estiramiento.",
  },
  {
    id: "seated_calf_raise",
    name: "Elevación de talones sentado",
    category: "feet",
    muscle: "Sóleo",
    description: "Sentado con las rodillas dobladas y el peso sobre ellas, sube los talones y baja despacio para trabajar el sóleo.",
  },
  {
    id: "tibialis_raise",
    name: "Elevación de puntas",
    category: "feet",
    muscle: "Tibial anterior",
    description: "Con la espalda apoyada en una pared y los talones adelantados, sube las puntas de los pies hacia las espinillas y baja despacio.",
  },
  {
    id: "short_foot",
    name: "Pie corto",
    category: "feet",
    muscle: "Arco del pie",
    description: "De pie o sentado, acerca la base del dedo gordo al talón sin encoger los dedos para activar el arco del pie.",
  },

  // Cardio
  {
    id: "running",
    name: "Correr",
    category: "cardio",
    muscle: "Cuerpo completo",
    description: "Carrera continua al aire libre o en cinta, a un ritmo que puedas mantener durante todo el tiempo previsto.",
  },
  {
    id: "stationary_bike",
    name: "Bici estática",
    category: "cardio",
    muscle: "Piernas",
    description: "Pedaleo continuo en una bicicleta fija, con la resistencia ajustada al esfuerzo que quieras mantener.",
  },
  {
    id: "elliptical",
    name: "Elíptica",
    category: "cardio",
    muscle: "Cuerpo completo",
    description: "Movimiento fluido de zancada sobre la máquina, con poco impacto para las articulaciones y brazos y piernas trabajando a la vez.",
  },
  {
    id: "rowing_machine",
    name: "Remo",
    category: "cardio",
    muscle: "Cuerpo completo",
    description: "Tracción continua en el ergómetro, empujando primero con las piernas, luego inclinando el torso y por último tirando con los brazos.",
  },
  {
    id: "jump_rope",
    name: "Comba",
    category: "cardio",
    muscle: "Cuerpo completo",
    description: "Saltos continuos con pequeños rebotes sobre la parte delantera del pie, haciendo girar la cuerda con las muñecas.",
  },
  {
    id: "brisk_walk",
    name: "Caminar rápido",
    category: "cardio",
    muscle: "Piernas",
    description: "Marcha a paso ligero, lo bastante rápida para subir las pulsaciones sin llegar a correr.",
  },
  {
    id: "zone_2",
    name: "Zona 2",
    category: "cardio",
    muscle: "Cuerpo completo",
    description: "Cardio suave y sostenido, a un ritmo en el que todavía podrías hablar con frases completas.",
  },

  // Movilidad
  {
    id: "hip_90_90",
    name: "Movilidad de cadera 90/90",
    category: "mobility",
    muscle: "Cadera",
    description: "Sentado con ambas rodillas dobladas a 90 grados, gira la cadera de un lado a otro pasando las piernas de una posición a la otra.",
  },
  {
    id: "cat_cow",
    name: "Gato-camello",
    category: "mobility",
    muscle: "Columna",
    description: "A cuatro apoyos, alterna redondear la espalda hacia arriba y hundirla hacia abajo, despacio y al ritmo de la respiración.",
  },
  {
    id: "thoracic_rotation",
    name: "Rotación torácica",
    category: "mobility",
    muscle: "Columna",
    description: "A cuatro apoyos con una mano detrás de la cabeza, gira el torso abriendo el codo hacia el techo y vuelve despacio.",
  },
];

// INSERT OR IGNORE: ejecutarla varias veces no duplica ni pisa lo que el usuario haya editado o archivado.
export async function seedExercises(db: D1Database): Promise<void> {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO exercises (id, name, category, muscle, description, is_custom, archived) VALUES (?, ?, ?, ?, ?, 0, 0)",
  );
  await db.batch(
    SEED_EXERCISES.map(({ id, name, category, muscle, description }) =>
      insert.bind(id, name, category, muscle, description),
    ),
  );
}
