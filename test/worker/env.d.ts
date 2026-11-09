// Bindings que solo existen en los tests (los añade vitest.config.ts).
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
  }
}

// Vite entrega el contenido de un archivo como texto con el sufijo ?raw.
declare module "*?raw" {
  const content: string;
  export default content;
}
