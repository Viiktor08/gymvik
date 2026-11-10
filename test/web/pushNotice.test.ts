import { describe, expect, it, vi } from "vitest";
import {
  noticeFromPush,
  openTarget,
  safeTarget,
  type ClientsLike,
  type PushDataLike,
  type WindowLike,
} from "../../src/web/pushNotice";

const ORIGIN = "https://gymvik.example";

/** Lo que `event.data` ofrece al service worker: `json()` y `text()` sobre el mismo cuerpo. */
function pushData(body: string): PushDataLike {
  return { json: () => JSON.parse(body) as unknown, text: () => body };
}

describe("noticeFromPush", () => {
  it("convierte el aviso del servidor en título, cuerpo y la ruta que abrirá", () => {
    const notice = noticeFromPush(
      pushData(JSON.stringify({ type: "today", title: "Gymvik", body: "Hoy toca Pecho (6 ejercicios)", url: "/" })),
    );
    expect(notice).toEqual({ title: "Gymvik", options: { body: "Hoy toca Pecho (6 ejercicios)", data: { url: "/" } } });
  });

  it("no usa el tipo como tag: un aviso de prueba no debe sustituir a uno de verdad", () => {
    const notice = noticeFromPush(pushData(JSON.stringify({ type: "today", title: "T", body: "B", url: "/" })));
    expect(notice.options).not.toHaveProperty("tag");
  });

  it("acepta una ruta interna con varias partes", () => {
    const notice = noticeFromPush(pushData(JSON.stringify({ type: "streak", title: "T", body: "B", url: "/progreso" })));
    expect(notice.options.data.url).toBe("/progreso");
  });

  it("sin título usa Gymvik, y sin cuerpo no lo pone", () => {
    const notice = noticeFromPush(pushData(JSON.stringify({ type: "steps", url: "/" })));
    expect(notice.title).toBe("Gymvik");
    expect(notice.options).not.toHaveProperty("body");
  });

  it("ignora campos que no son texto", () => {
    const notice = noticeFromPush(pushData(JSON.stringify({ title: 7, body: { a: 1 }, url: ["/x"] })));
    expect(notice).toEqual({ title: "Gymvik", options: { data: { url: "/" } } });
  });

  it("un título solo con espacios cuenta como vacío", () => {
    expect(noticeFromPush(pushData(JSON.stringify({ title: "   ", body: "B" }))).title).toBe("Gymvik");
  });

  // iOS retira la suscripción de una web que recibe un push sin enseñar nada: siempre hay que mostrar algo.
  it("un texto que no es JSON se enseña tal cual", () => {
    const notice = noticeFromPush(pushData("Prueba desde las herramientas del navegador"));
    expect(notice).toEqual({
      title: "Gymvik",
      options: { body: "Prueba desde las herramientas del navegador", data: { url: "/" } },
    });
  });

  it("sin datos enseña un aviso genérico", () => {
    const notice = noticeFromPush(null);
    expect(notice.title).toBe("Gymvik");
    expect(notice.options.body).toBe("Tienes un aviso nuevo.");
    expect(notice.options.data.url).toBe("/");
  });

  it("un JSON que no es un objeto (null, un número, una lista) enseña el aviso genérico", () => {
    for (const body of ["null", "42", "[1,2]", '"hola"']) {
      const notice = noticeFromPush(pushData(body));
      expect(notice.title).toBe("Gymvik");
      expect(notice.options.data.url).toBe("/");
    }
  });

  it("si ni json() ni text() se pueden leer, enseña el aviso genérico", () => {
    const broken: PushDataLike = {
      json: () => {
        throw new SyntaxError("mal");
      },
      text: () => {
        throw new Error("mal");
      },
    };
    expect(noticeFromPush(broken).options.body).toBe("Tienes un aviso nuevo.");
  });
});

describe("safeTarget", () => {
  it("deja pasar las rutas internas", () => {
    expect(safeTarget("/")).toBe("/");
    expect(safeTarget("/entreno/sesion")).toBe("/entreno/sesion");
    expect(safeTarget("/ajustes?x=1#y")).toBe("/ajustes?x=1#y");
  });

  it("lo que no es una ruta interna lleva a Hoy", () => {
    for (const value of [
      "https://otro.example/",
      "//otro.example/",
      "/\\otro.example",
      "/\t/otro.example",
      "/\n/otro.example",
      "javascript:alert(1)",
      "entreno",
      "",
      "   ",
      undefined,
      null,
      42,
      {},
    ]) {
      expect(safeTarget(value), String(value)).toBe("/");
    }
  });
});

function windowClient(url: string, extra: Partial<WindowLike> = {}): WindowLike {
  return {
    url,
    focused: false,
    focus: vi.fn(async () => undefined),
    navigate: vi.fn(async () => undefined),
    ...extra,
  };
}

function clientsWith(windows: WindowLike[]) {
  const openWindow = vi.fn(async () => undefined);
  const matchAll = vi.fn(async () => windows);
  const clients: ClientsLike = { matchAll, openWindow };
  return { clients, matchAll, openWindow };
}

describe("openTarget", () => {
  it("sin ninguna ventana de la app abre una nueva con la ruta completa", async () => {
    const { clients, matchAll, openWindow } = clientsWith([]);
    await openTarget(clients, "/progreso", ORIGIN);
    expect(matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/progreso`);
  });

  it("con la app abierta la enfoca y la lleva a la ruta del aviso", async () => {
    const open = windowClient(`${ORIGIN}/entreno`);
    const { clients, openWindow } = clientsWith([open]);
    await openTarget(clients, "/", ORIGIN);
    expect(open.focus).toHaveBeenCalledOnce();
    expect(open.navigate).toHaveBeenCalledWith(`${ORIGIN}/`);
    expect(openWindow).not.toHaveBeenCalled();
  });

  it("si ya está en esa ruta solo la enfoca (no recarga)", async () => {
    const open = windowClient(`${ORIGIN}/progreso`);
    const { clients } = clientsWith([open]);
    await openTarget(clients, "/progreso", ORIGIN);
    expect(open.focus).toHaveBeenCalledOnce();
    expect(open.navigate).not.toHaveBeenCalled();
  });

  it("con varias ventanas elige la que tiene el foco", async () => {
    const background = windowClient(`${ORIGIN}/entreno`);
    const front = windowClient(`${ORIGIN}/ajustes`, { focused: true });
    const { clients } = clientsWith([background, front]);
    await openTarget(clients, "/", ORIGIN);
    expect(front.focus).toHaveBeenCalledOnce();
    expect(background.focus).not.toHaveBeenCalled();
  });

  it("si la ventana no se puede enfocar abre una nueva", async () => {
    const open = windowClient(`${ORIGIN}/entreno`, {
      focus: vi.fn(async () => {
        throw new Error("sin foco");
      }),
    });
    const { clients, openWindow } = clientsWith([open]);
    await openTarget(clients, "/", ORIGIN);
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it("si la ventana no se puede llevar a la ruta abre una nueva", async () => {
    const open = windowClient(`${ORIGIN}/entreno`, {
      navigate: vi.fn(async () => {
        throw new Error("sin navegar");
      }),
    });
    const { clients, openWindow } = clientsWith([open]);
    await openTarget(clients, "/", ORIGIN);
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });

  it("en un navegador sin WindowClient.navigate abre una nueva en lugar de dejar la ventana donde estaba", async () => {
    const open = windowClient(`${ORIGIN}/entreno`, { navigate: undefined });
    const { clients, openWindow } = clientsWith([open]);
    await openTarget(clients, "/", ORIGIN);
    expect(openWindow).toHaveBeenCalledWith(`${ORIGIN}/`);
  });
});
