# Verificación en el iPhone

Lista para hacer de una pasada con la app desplegada en <https://<tu-app>.<tu-subdominio>.workers.dev> (iPhone con iOS 16.4 o posterior, Safari). Todo lo de aquí necesita el móvil real: Face ID, la PWA instalada, el modo avión, la app Atajos y el servicio de avisos de Apple no se pueden simular. La tarea 25 se cierra cuando todas las casillas están marcadas.

Si algo falla, apunta qué pantalla, qué hiciste y qué pasó (una captura ayuda) antes de seguir.

## Antes de empezar

- [ ] Tienes la URL de configuración (`https://<tu-app>.<tu-subdominio>.workers.dev/setup?token=…`). Está en `.superpowers/setup-url.txt`, en el Mac; no la pegues en ningún sitio compartido.
- [ ] Tienes a mano papel o un gestor de contraseñas para los 8 códigos de recuperación.
- [ ] Vas a probar el modo avión y los avisos: déjate un par de días para la parte "al día siguiente" de la sección 5.

## 1. Instalación y Face ID

- [ ] Abre la URL de configuración en Safari. Se ve la pantalla de primer arranque.
- [ ] "Crear passkey" y confirma con Face ID. Salen 8 códigos de recuperación con el formato `xxxx-xxxx-xxxx-xxxx`.
- [ ] Guarda los 8 códigos fuera del móvil y pulsa "Los he guardado". Llegas a Hoy con las pestañas y el icono de Ajustes.
- [ ] Safari, Compartir, "Añadir a pantalla de inicio": el nombre es "Gymvik", el icono es la barra con pesas y no tiene esquinas negras.
- [ ] Abre la app desde el icono: va a pantalla completa, sin barra de Safari.
- [ ] La barra superior y la barra de pestañas no chocan con el notch ni con el indicador de inicio, y la última tarjeta no queda tapada por la barra de pestañas. Mira también la barra de estado en claro y en oscuro (se eligió `default`; si queda mal, probar `black-translucent` y ajustar el borde superior).
- [ ] Cierra la app del todo y ábrela: si la sesión ya no vale, "Entrar con passkey" y Face ID te llevan a Hoy.
- [ ] En Ajustes, "Zona horaria" abre el selector (son unas 420 entradas) y deja elegida `Europe/Madrid` sin que la pantalla haga zoom.

## 2. Rutinas, biblioteca y rotación

- [ ] Entreno, "Nueva rutina": añade 3 ejercicios desde el selector, sube uno, quita otro y guarda. Al reabrirla están el orden, las series, las repeticiones y el descanso.
- [ ] Crea 3 rutinas en la rotación y 1 fuera de ella. Hoy muestra la que toca ("Te toca hoy") y la etiqueta SIGUIENTE.
- [ ] Reordena la rotación con Subir y Bajar. Tras terminar un entreno (sección 3), "Te toca hoy" sigue el orden nuevo.
- [ ] Biblioteca: busca con tildes ("triceps"), filtra por categoría, crea un ejercicio con un enlace de imagen `https://` (la imagen se ve) y otro con un enlace de vídeo (se abre en una pestaña nueva).
- [ ] Ficha de un ejercicio con entrenos reales: al tocar la gráfica, el valor sigue al dedo; "Última" y el historial coinciden con lo hecho.
- [ ] Archiva un ejercicio usado en un entreno: desaparece de Biblioteca y del selector, pero en el historial sigue saliendo por su nombre.
- [ ] Archiva una rutina desde su editor: desaparece de la lista y de la rotación.

## 3. Sesión en modo avión

- [ ] Con conexión, abre la app una vez (se guarda la copia sin conexión). Ciérrala del todo.
- [ ] Activa el modo avión y abre la app desde el icono: abre, Hoy dice "Sin conexión" y ofrece Reintentar.
- [ ] Entreno, empieza una rutina, rellena y marca series. En los campos de peso sale el teclado decimal y acepta "57,5" sin hacer zoom (los campos son de 16 px).
- [ ] Al marcar ✓ en un ejercicio con descanso corto, suenan tres pitidos al acabar la cuenta atrás (con el timbre activado; con el interruptor de silencio puesto, iOS los silencia, y es lo esperado).
- [ ] Marca ✓, bloquea el móvil 40 segundos y vuelve: la cuenta atrás refleja el tiempo real y no suena tarde.
- [ ] Cierra la app a media sesión y ábrela: Hoy muestra "Tienes un entreno en curso" con Continuar, y la sesión sigue donde estaba.
- [ ] Cambia la estructura de la rutina durante la sesión (añadir o quitar un ejercicio o una serie) y pulsa Terminar: sale "¿Guardar estos cambios en la rutina o solo para hoy?". Comprueba los dos sentidos: "Guardar en la rutina" cambia la rutina y "Solo para hoy" la deja como estaba.
- [ ] Termina el entreno: el resumen dice "Récords pendientes de sincronizar".
- [ ] Quita el modo avión y abre la app: el entreno aparece en Historial una sola vez, sin duplicados.
- [ ] Con un entreno en cola (sin red) y la sesión caducada, al volver la red no se pierde: se envía tras volver a iniciar sesión.
- [ ] Historial, "Apuntar entreno pasado": el selector de fecha no deja elegir un día futuro y el formulario cabe sin scroll horizontal. Guarda uno de la semana pasada: aparece bajo su "Semana del …".
- [ ] Abre un entreno del historial, cambia un peso y las notas, guarda y recarga: se conserva. "Borrar entreno", Cancelar no hace nada y "Sí, borrar" lo quita.

## 4. Atajos y NFC

Sigue la guía de Ajustes, "Atajos y NFC", con la app Atajos en español.

- [ ] Los nombres de las acciones de la guía coinciden con los de Atajos (Obtener contenido de URL, Obtener valor del diccionario, Mostrar notificación, Buscar muestras de salud, Calcular estadísticas, Redondear número, Ejecutar atajo, Ejecutar inmediatamente, Notificar al ejecutar).
- [ ] Atajo de creatina: ejecútalo y la creatina de hoy queda marcada en Hoy. Un segundo escaneo o ejecución dice "Ya estaba marcada" y no duplica.
- [ ] Pegatina NFC: la automatización marca la creatina. Abre la app: la tarjeta pone "Tomada hoy" sin recargar a mano.
- [ ] Ajustes, revoca la clave de creatina y ejecuta el atajo otra vez: falla con 401. (Con "Obtener valor del diccionario" el aviso puede salir vacío; la guía lo explica.)
- [ ] Atajo "Gymvik Pasos": con el campo `steps` como Número da 200; con Texto da 400, como dice la guía.
- [ ] La suma de pasos del Atajo coincide con la app Salud (mismo día, mismas fuentes). Apunta ambas cifras.
- [ ] Automatización de los pasos (por hora del día): los pasos aparecen en Hoy sin abrir la app a mano.
- [ ] En Hoy, "Sincronizar" abre Atajos, ejecuta el atajo y vuelve a Gymvik; los pasos de Hoy se actualizan solos al volver. Prueba también que el nombre con espacios se encuentra. Si la PWA no vuelve a primer plano, usa el enlace "◀ Gymvik" y anota qué ocurre.

## 5. Avisos

- [ ] Ajustes, Notificaciones, "Activar notificaciones": iOS pide permiso al primer toque y queda "Notificaciones activadas en este dispositivo.". Con las notificaciones bloqueadas para Gymvik en iOS, sale el mensaje que remite a los Ajustes de iOS.
- [ ] "Enviar aviso de prueba" con el móvil bloqueado: llega "Aviso de prueba ✓". Al tocarlo se abre o enfoca la app en Hoy.
- [ ] Si el envío dice que se quitó una suscripción, "Activar notificaciones" vuelve a funcionar.
- [ ] Peso: toca un aviso de peso (o abre `/?peso=1`): Hoy se abre con la hoja "Apuntar peso" ya abierta, el teclado decimal sale y acepta "57,5" sin zoom.
- [ ] Las horas de los avisos se guardan con la rueda de hora (cada cambio se guarda).
- [ ] Al día siguiente llegan los avisos reales a su hora y solo una vez al día cada uno. Comprueba la hora local, no la UTC.

## 6. Progreso y aspecto

- [ ] Peso apuntado desde Hoy: aparece en la gráfica de Progreso.
- [ ] Peso: cambia entre 4 semanas, 12 semanas y Todo. Al tocar la gráfica, el valor sigue al dedo y la página no se desplaza. "Último" coincide con el último peso.
- [ ] Colores de las gráficas en iOS Safari: la media de 7 días es azul y gruesa, el peso diario gris y fino, la grasa naranja. Cambian con el modo oscuro del sistema.
- [ ] Semana: compara con tu semana real (entrenos N/objetivo, volumen, cardio, pasos del Atajo, días de creatina) y con las flechas respecto a la semana anterior. En un iPhone pequeño la tabla no se pisa. Con suficientes entrenos en una semana cerrada, la racha sube.
- [ ] Ejercicios: elige uno de fuerza y uno de cardio. Los récords y sus fechas coinciden con el historial; un ejercicio archivado sale como "(archivado)". El selector nativo se abre sin hacer zoom.
- [ ] Primera carga de Progreso con mala conexión: sale "Cargando gráfica…". Hoy y el inicio de sesión no descargan el trozo de las gráficas (Inspector web de Safari, pestaña Red).
- [ ] Cambia el color en Ajustes, "Tema", cierra la app y ábrela: se conserva.
- [ ] Modo oscuro: cambia el aspecto del iPhone con la app abierta; el acento y las barras cambian sin recargar. Mira también las muestras de color y la guía.
- [ ] Todos los botones y controles se pulsan con comodidad y las hojas se desplazan con el teclado abierto.

## 7. Copia de seguridad y seguridad

- [ ] Ajustes, "Exportar JSON": se abre o ofrece guardar el archivo (en la app instalada se comporta distinto que en Chrome de escritorio). Guarda la copia en Archivos o en tu nube.
- [ ] Ajustes, "Importar JSON" abre el selector de Archivos. No lo ejecutes con datos reales salvo que quieras probar la restauración.
- [ ] Ajustes, "Añadir passkey de este dispositivo" y "Quitar" funcionan con Face ID. Quitar una passkey cierra también la sesión de tus otros dispositivos, y la hoja de confirmación lo avisa.
- [ ] Recuperación (al final, porque gasta un código de los 8): en `/recuperar` introduce un código y crea la passkey nueva con Face ID. Sale "Passkey creada" con Continuar y después puedes quitar la passkey del móvil perdido desde Ajustes. Guarda la lista de códigos que te quedan.

## Después de verificar

- [ ] Despliegue de una versión nueva (opcional, tras un cambio de versión en `package.json`): abre la app instalada, Ajustes, Actualizar, y comprueba que recarga y enseña la versión nueva.
- [ ] Marca la tarea 25 como hecha y guarda aquí las incidencias que hayan salido.
