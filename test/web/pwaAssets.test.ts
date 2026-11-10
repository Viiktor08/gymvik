// Los archivos estáticos que hacen la app instalable: iconos (scripts/icons.py) y metas de index.html.
// Lee archivos con Node: se comprueba con tsconfig.json (tipos de Node, sin DOM) y no con tsconfig.web.json.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

type Png = { width: number; height: number; alphaAt: (x: number, y: number) => number };

/** Lee un PNG RGBA de 8 bits sin filtros (el que escribe scripts/icons.py). */
function readPng(file: string): Png {
  const bytes = readFileSync(join(ROOT, "public", "icons", file));
  expect(bytes.subarray(1, 4).toString("ascii"), `${file} no es un PNG`).toBe("PNG");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  expect([bytes[24], bytes[25]], `${file}: RGBA de 8 bits`).toEqual([8, 6]);
  const data: Buffer[] = [];
  for (let offset = 8; offset < bytes.length; ) {
    const length = bytes.readUInt32BE(offset);
    if (bytes.subarray(offset + 4, offset + 8).toString("ascii") === "IDAT") data.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4 + 1;
  return {
    width,
    height,
    alphaAt: (x, y) => raw[y * stride + 1 + x * 4 + 3] ?? -1,
  };
}

describe("iconos de la app", () => {
  it.each([
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
    ["apple-touch-icon.png", 180],
  ])("%s mide %i×%i", (file, size) => {
    const png = readPng(file);
    expect([png.width, png.height]).toEqual([size, size]);
  });

  // iOS pinta de negro lo transparente del icono de la pantalla de inicio, y Android recorta el "maskable".
  it.each(["icon-maskable-512.png", "apple-touch-icon.png"])("%s llena todo el cuadrado, sin esquinas transparentes", (file) => {
    const png = readPng(file);
    for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1]] as const) {
      expect(png.alphaAt(x, y), `${file} (${x}, ${y})`).toBe(255);
    }
  });

  it.each(["icon-192.png", "icon-512.png"])("%s tiene las esquinas redondeadas y el centro opaco", (file) => {
    const png = readPng(file);
    expect(png.alphaAt(0, 0)).toBe(0);
    expect(png.alphaAt(png.width >> 1, png.height >> 1)).toBe(255);
  });
});

describe("index.html", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");

  it("declara el icono de iOS, el de la pestaña y las metas de app instalada, y esos archivos existen", () => {
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(html).toContain('<link rel="icon" href="/icons/favicon-32.png" type="image/png" sizes="32x32" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="mobile-web-app-capable" content="yes" />');
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Gymvik" />');
    expect(html).toContain('<meta name="theme-color" content="#1b7a4b" />');
    for (const file of ["apple-touch-icon.png", "favicon-32.png"]) expect(existsSync(join(ROOT, "public", "icons", file)), file).toBe(true);
  });

  it("no lleva scripts ni estilos incrustados (la CSP no los permite)", () => {
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/);
    expect(html).not.toMatch(/<style|\sstyle=/);
  });
});
