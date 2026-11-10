// Service worker de la app. vite-plugin-pwa (strategies: "injectManifest") lo compila a /sw.js y sustituye
// `self.__WB_MANIFEST` por la lista del esqueleto de la compilación (HTML, JS, CSS e iconos con su versión).
//
// Qué hace:
//  - Precachea ese esqueleto para que la app abra sin red; las navegaciones caen en index.html (menos /api/).
//  - Nada más se intercepta: /api/* va siempre a la red y no se cachea (no hay ninguna ruta de ejecución).
//  - Enseña los avisos push y, al tocarlos, abre o enfoca la app.
//  - Una versión nueva espera hasta que Ajustes → Actualizar se lo pide (mensaje SKIP_WAITING).
import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { noticeFromPush, openTarget } from "./pushNotice";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0];
};

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Sin red, cualquier pantalla de la app (/entreno, /ajustes…) es el mismo index.html; React Router hace el resto.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: [/^\/api\//] }));

// La versión nueva (tras SKIP_WAITING) toma el control de la pestaña abierta, y la página se recarga con ella.
clientsClaim();

self.addEventListener("message", (event) => {
  const message: unknown = event.data;
  if (typeof message === "object" && message !== null && "type" in message && message.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

self.addEventListener("push", (event) => {
  const notice = noticeFromPush(event.data);
  event.waitUntil(self.registration.showNotification(notice.title, notice.options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data: unknown = event.notification.data;
  const url = typeof data === "object" && data !== null && "url" in data ? data.url : undefined;
  event.waitUntil(openTarget(self.clients, typeof url === "string" ? url : "/", self.location.origin));
});
