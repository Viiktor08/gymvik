// Autenticador WebAuthn por software, solo para tests: genera claves ES256 con
// WebCrypto y construye las mismas respuestas que un navegador, para ejercitar
// la verificación real de @simplewebauthn/server dentro de workerd.

const encoder = new TextEncoder();

function utf8(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(encoder.encode(text));
}

// --- CBOR mínimo: enteros, bytes, texto y mapas, lo justo para un attestationObject. ---

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

function cborHead(major: number, value: number): number[] {
  if (value < 24) return [(major << 5) | value];
  if (value < 256) return [(major << 5) | 24, value];
  if (value < 65536) return [(major << 5) | 25, value >> 8, value & 0xff];
  throw new RangeError("CBOR de prueba: valor demasiado grande");
}

function cbor(value: Cbor): number[] {
  if (typeof value === "number") return value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value);
  if (typeof value === "string") {
    const bytes = encoder.encode(value);
    return [...cborHead(3, bytes.length), ...bytes];
  }
  if (value instanceof Uint8Array) return [...cborHead(2, value.length), ...value];
  const out = cborHead(5, value.size);
  for (const [key, entry] of value) out.push(...cbor(key), ...cbor(entry));
  return out;
}

// --- Utilidades ---

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

function uint32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
}

function derInteger(raw: Uint8Array): number[] {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  const body = [...raw.slice(start)];
  if (((body[0] as number) & 0x80) !== 0) body.unshift(0);
  return [0x02, body.length, ...body];
}

/** WebCrypto firma ECDSA como r||s; WebAuthn la espera en ASN.1 DER. */
function rawSignatureToDer(raw: Uint8Array): Uint8Array {
  const body = [...derInteger(raw.slice(0, 32)), ...derInteger(raw.slice(32))];
  return new Uint8Array([0x30, body.length, ...body]);
}

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export type CeremonyOptions = {
  challenge: string;
  origin: string;
  rpId: string;
  /** Si el usuario se verificó (Face ID). Por defecto sí. */
  userVerified?: boolean;
};

export class SoftAuthenticator {
  readonly credentialId: Uint8Array;
  counter = 0;

  private constructor(
    private readonly keys: CryptoKeyPair,
    private readonly publicKeyRaw: Uint8Array,
    credentialId: Uint8Array,
  ) {
    this.credentialId = credentialId;
  }

  static async create(credentialId: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<SoftAuthenticator> {
    const keys = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const raw = new Uint8Array((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
    return new SoftAuthenticator(keys, raw, credentialId);
  }

  get id(): string {
    return toBase64Url(this.credentialId);
  }

  private clientData(type: string, { challenge, origin }: CeremonyOptions): Uint8Array<ArrayBuffer> {
    return utf8(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  }

  private flags(options: CeremonyOptions, extra = 0): number {
    return FLAG_UP | (options.userVerified === false ? 0 : FLAG_UV) | extra;
  }

  /** Respuesta de navigator.credentials.create() con attestation "none". */
  async register(options: CeremonyOptions) {
    const coseKey = new Map<Cbor, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, this.publicKeyRaw.slice(1, 33)],
      [-3, this.publicKeyRaw.slice(33, 65)],
    ]);
    const credentialIdLength = new Uint8Array([this.credentialId.length >> 8, this.credentialId.length & 0xff]);
    const authData = concat(
      await sha256(utf8(options.rpId)),
      new Uint8Array([this.flags(options, FLAG_AT)]),
      uint32(this.counter),
      new Uint8Array(16), // aaguid
      credentialIdLength,
      this.credentialId,
      new Uint8Array(cbor(coseKey)),
    );
    const attestationObject = new Uint8Array(
      cbor(
        new Map<Cbor, Cbor>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData],
        ]),
      ),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(this.clientData("webauthn.create", options)),
        attestationObject: toBase64Url(attestationObject),
        transports: ["internal"],
      },
    };
  }

  /** Respuesta de navigator.credentials.get(). `counter` fuerza el contador de la firma. */
  async assert(options: CeremonyOptions & { counter?: number; signWith?: SoftAuthenticator }) {
    this.counter = options.counter ?? this.counter + 1;
    const authData = concat(
      await sha256(utf8(options.rpId)),
      new Uint8Array([this.flags(options)]),
      uint32(this.counter),
    );
    const clientDataJSON = this.clientData("webauthn.get", options);
    const signed = concat(authData, await sha256(clientDataJSON));
    const signer = options.signWith ?? this;
    const raw = new Uint8Array(
      await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.keys.privateKey, signed),
    );
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key" as const,
      authenticatorAttachment: "platform" as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: toBase64Url(clientDataJSON),
        authenticatorData: toBase64Url(authData),
        signature: toBase64Url(rawSignatureToDer(raw)),
      },
    };
  }
}
