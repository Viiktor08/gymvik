import { afterEach, describe, expect, it, vi } from "vitest";
import { isInstalled, pushSupported, urlBase64ToUint8Array } from "../../src/web/settings/push";

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "standalone");
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("urlBase64ToUint8Array", () => {
  it("convierte base64url (con - y _, sin relleno) en los bytes originales", () => {
    // 0xfb 0xff 0xfe en base64 estándar es "+//+", y en base64url "-__-".
    expect(Array.from(urlBase64ToUint8Array("-__-"))).toEqual([0xfb, 0xff, 0xfe]);
  });

  it("repone el relleno que falta en la longitud", () => {
    expect(Array.from(urlBase64ToUint8Array("AQ"))).toEqual([1]);
    expect(Array.from(urlBase64ToUint8Array("AQI"))).toEqual([1, 2]);
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
  });

  it("una cadena vacía son cero bytes", () => {
    expect(urlBase64ToUint8Array("").length).toBe(0);
  });

  it("devuelve un Uint8Array, que es lo que pide applicationServerKey", () => {
    expect(urlBase64ToUint8Array("AQID")).toBeInstanceOf(Uint8Array);
  });
});

describe("isInstalled", () => {
  it("es falso en una pestaña normal del navegador", () => {
    expect(isInstalled()).toBe(false);
  });

  it("es verdadero con display-mode: standalone", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(display-mode: standalone)" }));
    expect(isInstalled()).toBe(true);
  });

  it("es verdadero con navigator.standalone (Safari de iOS)", () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: true });
    expect(isInstalled()).toBe(true);
  });

  it("navigator.standalone en falso no cuenta", () => {
    Object.defineProperty(navigator, "standalone", { configurable: true, value: false });
    expect(isInstalled()).toBe(false);
  });
});

describe("pushSupported", () => {
  it("pide Notification, service worker y PushManager a la vez", () => {
    expect(pushSupported()).toBe(false);

    vi.stubGlobal("Notification", class {});
    expect(pushSupported()).toBe(false);

    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
    expect(pushSupported()).toBe(false);

    vi.stubGlobal("PushManager", class {});
    expect(pushSupported()).toBe(true);
  });
});
