// Genera un par de claves VAPID (P-256) para los avisos push.
//
//   node scripts/vapid.ts --put      genera el par y lo guarda como secretos de Cloudflare
//                                    (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY) con `wrangler secret put`.
//                                    Solo imprime la clave pública: la privada nunca sale de este proceso.
//   node scripts/vapid.ts --print    imprime las dos líneas VAPID_PUBLIC_KEY=... y VAPID_PRIVATE_KEY=...
//                                    para pegarlas en .dev.vars. Es la única forma de ver la privada.
//   node scripts/vapid.ts            no hace nada: enseña este uso.
//
// Formato que espera @block65/webcrypto-web-push (el mismo que genera vitest.config.ts para los tests):
// pública = punto sin comprimir (0x04 + X + Y, 65 bytes) y privada = el escalar `d` (32 bytes), las dos en
// base64url. Se ejecuta con Node directamente (quita los tipos al cargar).
//
// Cambiar las claves invalida las suscripciones push que ya existan: hay que volver a activar los avisos en
// Ajustes de la app.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { join } from "node:path";

const mode = process.argv[2];
if (mode !== "--put" && mode !== "--print") {
  console.error("Uso: node scripts/vapid.ts --put | --print");
  console.error("  --put    guarda el par nuevo como secretos de Cloudflare (no imprime la privada)");
  console.error("  --print  imprime el par para .dev.vars (imprime la privada)");
  process.exit(1);
}

const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
const point = Buffer.concat([Buffer.from([0x04]), Buffer.from(jwk.x!, "base64url"), Buffer.from(jwk.y!, "base64url")]);
const publicKey = point.toString("base64url");
const privateKey = jwk.d!;

if (mode === "--print") {
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
} else {
  // El valor entra por la entrada estándar: no aparece en los argumentos ni en el historial.
  const put = (name: string, value: string): void => {
    execFileSync("npx", ["wrangler", "secret", "put", name], {
      cwd: join(import.meta.dirname, ".."),
      input: value,
      stdio: ["pipe", "inherit", "inherit"],
    });
  };
  put("VAPID_PUBLIC_KEY", publicKey);
  put("VAPID_PRIVATE_KEY", privateKey);
  console.log(`Claves VAPID guardadas en Cloudflare. Clave pública: ${publicKey}`);
}
