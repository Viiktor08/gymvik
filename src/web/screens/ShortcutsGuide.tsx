import { useEffect, useId, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { Settings } from "../../shared/types";
import { api } from "../api";
import { ChevronLeftIcon } from "../components/icons";
import { UrlRow } from "../settings/HookUrls";

/** Nombre del Atajo de Salud que trae la base de datos (migración 0001) mientras no se cambie en Ajustes. */
const DEFAULT_SHORTCUT_NAME = "Gymvik Pasos";

/** El nombre guardado en Ajustes; mientras llega (o si no llega) vale el de por defecto. */
function useShortcutName(): string {
  const [name, setName] = useState(DEFAULT_SHORTCUT_NAME);
  useEffect(() => {
    let current = true;
    api<Pick<Settings, "shortcutName">>("/api/settings")
      .then((settings) => {
        if (current && settings.shortcutName.trim() !== "") setName(settings.shortcutName);
      })
      .catch(() => {
        // La guía se entiende igual con el nombre por defecto.
      });
    return () => {
      current = false;
    };
  }, []);
  return name;
}

function Guide({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className="stack" aria-labelledby={titleId}>
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
}

/** Guía paso a paso (spec §7) para montar los dos atajos de iOS y sus automatizaciones. */
export function ShortcutsGuide() {
  const shortcutName = useShortcutName();

  return (
    <section className="screen stack">
      <Link to="/ajustes" className="back-link">
        <ChevronLeftIcon />
        Ajustes
      </Link>
      <h1>Atajos y NFC</h1>
      <p className="muted">
        Con la app Atajos del iPhone, una pegatina NFC marca la creatina y otro atajo manda a Gymvik los pasos que lleva
        Salud.
      </p>

      <Guide title="Antes de empezar">
        <div className="card">
          <ol className="guide-steps">
            <li>
              Crea una clave en <Link to="/ajustes">Ajustes</Link>, en la sección Atajos y NFC. Dale el permiso Creatina para
              el atajo de creatina y el permiso Pasos para el de pasos; puedes usar una clave para cada uno o una sola con
              los dos permisos.
            </li>
            <li>
              Cuando aparezca la clave, cópiala y pégala en el atajo enseguida: se enseña una sola vez. Si la pierdes,
              revócala y crea otra.
            </li>
            <li>
              Los atajos se montan en la app Atajos del iPhone, no aquí. Los nombres entre «» son los de las acciones tal
              como salen en español.
            </li>
          </ol>
        </div>
      </Guide>

      <Guide title="Atajo Creatina">
        <div className="card">
          <p className="muted">
            Marca la creatina de hoy. Si ya estaba marcada no la duplica: solo te lo dice.
          </p>
          <ol className="guide-steps">
            <li>En la app Atajos toca + para crear un atajo nuevo y llámalo «Creatina».</li>
            <li>
              Añade la acción «Obtener contenido de URL» y, en el campo URL, pega esta dirección:
              <UrlRow hook="creatine" />
            </li>
            <li>Toca la flecha de la acción para ver sus opciones y pon el método en «POST».</li>
            <li>
              En «Encabezados» pulsa «Añadir nuevo encabezado». Como nombre escribe <code>Authorization</code> y como valor{" "}
              <code>Bearer &lt;clave&gt;</code>: la palabra Bearer, un espacio y tu clave, que empieza por <code>fk_</code>.
            </li>
            <li>
              No hace falta cuerpo: se marcan los gramos que tengas en Ajustes. Si un día quieres otra cantidad, elige
              «Cuerpo de la solicitud» en JSON y añade un campo de tipo «Número» llamado <code>grams</code>.
            </li>
            <li>
              Añade «Obtener valor del diccionario», elige «Valor» para la clave <code>message</code> y como diccionario
              «Contenido de la URL».
            </li>
            <li>
              Añade «Mostrar notificación» y como texto pon el valor que acabas de obtener. Saldrá «Creatina ✓ 5 g», o «Ya
              estaba marcada» si ya la habías marcado hoy.
            </li>
            <li>Pulsa ▶ para probar el atajo. Debe salir la notificación, y la tarjeta de creatina de Hoy quedará marcada.</li>
          </ol>

          <h3 className="card-title">Automatización con la pegatina NFC</h3>
          <ol className="guide-steps">
            <li>En Atajos abre la pestaña «Automatización», toca + y elige «Crear automatización personal».</li>
            <li>Elige «NFC», toca «Escanear» y acerca el iPhone a la pegatina. Ponle un nombre y confirma.</li>
            <li>Toca «Siguiente» y «Añadir acción», busca «Ejecutar atajo» y elige «Creatina».</li>
            <li>
              En la última pantalla marca «Ejecutar inmediatamente», para que no pregunte cada vez, y desactiva «Notificar al
              ejecutar» si no quieres el aviso extra de iOS. Termina con «Ok».
            </li>
            <li>Acerca el iPhone a la pegatina para comprobarlo.</li>
          </ol>
        </div>
      </Guide>

      <Guide title="Atajo Pasos">
        <div className="card">
          <p className="muted">
            Envía los pasos que lleva hoy el iPhone. Si se ejecuta varias veces el mismo día, vale el último valor.
          </p>
          <ol className="guide-steps">
            <li>
              Crea un atajo nuevo y llámalo exactamente «{shortcutName}». Es el nombre que tienes guardado en Ajustes y el que
              abre el botón «Sincronizar» de Hoy; si prefieres otro, cámbialo antes allí.
            </li>
            <li>
              Añade «Buscar muestras de salud». Pon el filtro «Tipo» igual a «Pasos» y añade otro filtro, «Fecha de inicio»
              igual a «hoy». Quita el límite de resultados.
            </li>
            <li>
              Añade «Calcular estadísticas» y elige «Suma» sobre las muestras: es el total de pasos de hoy. Si quieres
              asegurarte de que sea entero, añade después «Redondear número».
            </li>
            <li>
              Añade «Obtener contenido de URL» con esta dirección:
              <UrlRow hook="steps" />
            </li>
            <li>
              Pon el método en «POST» y añade el encabezado <code>Authorization</code> con el valor{" "}
              <code>Bearer &lt;clave&gt;</code>, igual que en el atajo de creatina.
            </li>
            <li>
              En «Cuerpo de la solicitud» elige «JSON» y pulsa «Añadir nuevo campo». Elige el tipo «Número», escribe{" "}
              <code>steps</code> como clave y, como valor, el resultado del paso 3.
              <p role="note" className="callout">
                <strong>El campo steps tiene que ser un Número, no un Texto.</strong> Si va como texto, Gymvik responde 400 y
                no guarda los pasos. El cuerpo debe quedar así:
                <code className="code-block">{'{ "steps": 8432 }'}</code>
              </p>
            </li>
            <li>
              Añade «Obtener valor del diccionario» para la clave <code>message</code> y después «Mostrar notificación» con
              ese valor. Verás algo como «Pasos: 8.432».
            </li>
            <li>Pulsa ▶ para probarlo. Los pasos deben aparecer en la tarjeta de Pasos de Hoy.</li>
          </ol>

          <h3 className="card-title">Automatizaciones a varias horas</h3>
          <ol className="guide-steps">
            <li>En «Automatización» toca + y elige «Crear automatización personal» y después «Hora del día».</li>
            <li>Elige una hora, por ejemplo las 10:00, y repite «Diariamente».</li>
            <li>
              Toca «Siguiente», «Añadir acción», busca «Ejecutar atajo» y elige «{shortcutName}».
            </li>
            <li>Marca «Ejecutar inmediatamente», desactiva «Notificar al ejecutar» si quieres y termina con «Ok».</li>
            <li>
              Repite con otras horas, por ejemplo a las 14:00, 18:00 y 22:00: cada automatización admite una sola hora. Así los
              pasos se van poniendo al día durante la jornada y el aviso de las 20:00 usa el último valor recibido.
            </li>
          </ol>
        </div>
      </Guide>

      <Guide title="Si algo falla">
        <div className="card">
          <ul className="guide-steps">
            <li>
              <strong>La notificación sale vacía.</strong> La respuesta fue un error y no trae <code>message</code>. Quita un
              momento «Obtener valor del diccionario» y muestra el «Contenido de la URL» entero para leer el motivo.
            </li>
            <li>
              <strong>Error 401.</strong> La clave está mal copiada, falta <code>Bearer </code> delante o fue revocada. Crea
              otra en Ajustes.
            </li>
            <li>
              <strong>Error 403.</strong> La clave no tiene el permiso de este atajo (Creatina o Pasos).
            </li>
            <li>
              <strong>Error 400.</strong> Lo enviado no es correcto. En el atajo de pasos casi siempre es que{" "}
              <code>steps</code> va como Texto en vez de Número, o que no es un entero entre 0 y 200.000.
            </li>
            <li>
              <strong>Error 429.</strong> Más de 30 peticiones en un minuto con la misma clave. Espera un poco.
            </li>
          </ul>
        </div>
      </Guide>
    </section>
  );
}
