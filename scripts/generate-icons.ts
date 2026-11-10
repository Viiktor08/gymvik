// Genera el icono de la app (public/icons/*): una barra con discos, inclinada, en blanco sobre el verde del tema.
//
//   npm run icons
//
// Sin dependencias: dibuja el icono con funciones de distancia y lo guarda como PNG. Los PNG se versionan
// (no se generan en cada compilación); este script solo hace falta si cambia el dibujo o los colores.
// Se ejecuta con Node directamente (quita los tipos al cargar).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";

type Rgba = readonly [number, number, number, number];

// Verde por defecto de la app (src/web/theme.ts) y uno más oscuro para el degradado del fondo.
const GREEN_TOP: Rgba = [39, 150, 94, 255];
const GREEN_BOTTOM: Rgba = [19, 97, 58, 255];
const WHITE: Rgba = [255, 255, 255, 255];

/** Un rectángulo redondeado centrado en (cx, 0) del eje de la barra, en unidades de medio lado del icono. */
type Part = { cx: number; halfW: number; halfH: number; radius: number; color: Rgba };

// Dibujo en el sistema de la barra: u a lo largo y v de través, a escala 1. Cabe en un círculo de radio 0,5; con
// la escala de cada variante sigue dentro de la zona segura de un icono "maskable" (círculo de radio 0,8).
const PARTS: Part[] = [
  { cx: 0, halfW: 0.5, halfH: 0.05, radius: 0.05, color: WHITE },
  { cx: -0.2, halfW: 0.06, halfH: 0.34, radius: 0.045, color: WHITE },
  { cx: 0.2, halfW: 0.06, halfH: 0.34, radius: 0.045, color: WHITE },
  { cx: -0.33, halfW: 0.045, halfH: 0.22, radius: 0.04, color: WHITE },
  { cx: 0.33, halfW: 0.045, halfH: 0.22, radius: 0.04, color: WHITE },
];
const TILT_DEGREES = -40;
const ANY_SCALE = 1.4;

type Variant = {
  file: string;
  size: number;
  /** El fondo llega hasta el borde (iconos "maskable" y el de iOS, que ya recortan ellos) o es un cuadrado redondeado. */
  fullBleed: boolean;
  /** Tamaño del dibujo respecto al de referencia. */
  scale: number;
};

const VARIANTS: Variant[] = [
  { file: "icon-192.png", size: 192, fullBleed: false, scale: ANY_SCALE },
  { file: "icon-512.png", size: 512, fullBleed: false, scale: ANY_SCALE },
  { file: "icon-maskable-512.png", size: 512, fullBleed: true, scale: 1.25 },
  { file: "apple-touch-icon.png", size: 180, fullBleed: true, scale: 1.3 },
];

const BACKGROUND_RADIUS = 0.22;
const SAMPLES = 4;

/** Distancia con signo a un rectángulo redondeado de semilados (hw, hh) y esquinas de radio r. */
function roundedRectDistance(x: number, y: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(x) - (hw - r);
  const qy = Math.abs(y) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Mezcla `top` encima de `base` (colores no premultiplicados). */
function over(base: Rgba, top: Rgba, coverage: number): Rgba {
  const a = (top[3] / 255) * coverage;
  const outA = a + (base[3] / 255) * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  const channel = (i: 0 | 1 | 2) => (top[i] * a + base[i] * (base[3] / 255) * (1 - a)) / outA;
  return [channel(0), channel(1), channel(2), outA * 255];
}

/** Color del icono en el punto (x, y) con x e y en [-1, 1] (y hacia abajo). */
function colorAt(x: number, y: number, variant: Variant): Rgba {
  let color: Rgba = [0, 0, 0, 0];
  if (variant.fullBleed || roundedRectDistance(x, y, 1, 1, BACKGROUND_RADIUS * 2) <= 0) {
    const t = (y + 1) / 2;
    const mix = (i: 0 | 1 | 2) => GREEN_TOP[i] + (GREEN_BOTTOM[i] - GREEN_TOP[i]) * t;
    color = [mix(0), mix(1), mix(2), 255];
  }
  const angle = (TILT_DEGREES * Math.PI) / 180;
  const u = (x * Math.cos(angle) + y * Math.sin(angle)) / variant.scale;
  const v = (-x * Math.sin(angle) + y * Math.cos(angle)) / variant.scale;
  for (const part of PARTS) {
    if (roundedRectDistance(u - part.cx, v, part.halfW, part.halfH, part.radius) <= 0) {
      color = over(color, part.color, 1);
    }
  }
  return color;
}

function render(variant: Variant): Uint8Array {
  const { size } = variant;
  const pixels = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Promedio de SAMPLES × SAMPLES puntos por píxel (alisado de bordes), con el alfa premultiplicado.
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 2 - 1;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 2 - 1;
          const [cr, cg, cb, ca] = colorAt(x, y, variant);
          const weight = ca / 255;
          r += cr * weight;
          g += cg * weight;
          b += cb * weight;
          a += weight;
        }
      }
      const total = SAMPLES * SAMPLES;
      const offset = (py * size + px) * 4;
      if (a > 0) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
      }
      pixels[offset + 3] = Math.round((a / total) * 255);
    }
  }
  return pixels;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** PNG RGBA de 8 bits, sin entrelazado y con el filtro 0 en todas las filas. */
function encodePng(size: number, pixels: Uint8Array): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let row = 0; row < size; row++) {
    raw[row * (stride + 1)] = 0;
    raw.set(pixels.subarray(row * stride, (row + 1) * stride), row * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** El mismo dibujo en vectorial, para la pestaña del navegador. */
function svg(): string {
  const view = 512;
  const half = view / 2;
  const scale = ANY_SCALE;
  const rect = ({ cx, halfW, halfH, radius }: Part) => {
    const w = halfW * 2 * half * scale;
    const h = halfH * 2 * half * scale;
    const x = half + (cx - halfW) * half * scale;
    const y = half - halfH * half * scale;
    const r = radius * half * scale;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${r.toFixed(1)}" fill="#fff"/>`;
  };
  const hex = (c: Rgba) => `#${c.slice(0, 3).map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${view} ${view}">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hex(GREEN_TOP)}"/><stop offset="1" stop-color="${hex(GREEN_BOTTOM)}"/></linearGradient></defs>`,
    `<rect width="${view}" height="${view}" rx="${BACKGROUND_RADIUS * view}" fill="url(#g)"/>`,
    `<g transform="rotate(${TILT_DEGREES} ${half} ${half})">`,
    ...PARTS.map(rect),
    "</g>",
    "</svg>",
    "",
  ].join("\n");
}

const outDir = join(import.meta.dirname, "..", "public", "icons");
mkdirSync(outDir, { recursive: true });
for (const variant of VARIANTS) {
  writeFileSync(join(outDir, variant.file), encodePng(variant.size, render(variant)));
  console.log(`${variant.file} (${variant.size}×${variant.size})`);
}
writeFileSync(join(outDir, "icon.svg"), svg());
console.log("icon.svg");
