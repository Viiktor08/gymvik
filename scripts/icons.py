# Genera los iconos de la app (public/icons/*.png) a partir de assets/icon-source.png.
#
#   npm run icons
#
# La imagen de origen es el icono "VK" con barra, en blanco sobre verde, con esquinas negras. El script extrae el
# logo blanco y lo pone sobre un fondo verde a sangre, sin esas esquinas:
#   - icon-192.png e icon-512.png ("any"): esquinas redondeadas transparentes.
#   - icon-maskable-512.png y apple-touch-icon.png: cuadrado lleno (iOS y Android recortan a su manera); el
#     maskable lleva el logo algo más pequeño para quedar dentro de la zona segura.
# Los PNG se escriben RGBA de 8 bits sin filtros, que es lo que lee test/web/pwaAssets.test.ts.
# Necesita Pillow (pip install pillow). Los PNG se versionan; solo hace falta volver a ejecutarlo si cambia el icono.
import struct
import zlib
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "icon-source.png"
OUT = ROOT / "public" / "icons"

# Zona del logo en la imagen de origen (1254 px). El fondo se mide fuera de ella y lejos de las esquinas negras.
LOGO_BOX = (150, 395, 1105, 875)
CENTER_BAND = range(320, 940, 4)  # columnas sin esquinas en las filas de arriba y de abajo
SIDE_BAND = list(range(60, 140, 4)) + list(range(1115, 1195, 4))  # columnas sin logo en las filas del logo


def background_rows(img):
    """Degradado vertical del fondo: recta ajustada por mínimos cuadrados a filas limpias, canal a canal."""
    px = img.load()
    ys, colors = [], []
    for y in range(20, img.height - 20, 4):
        columns = SIDE_BAND if LOGO_BOX[1] <= y < LOGO_BOX[3] else CENTER_BAND
        samples = [px[x, y] for x in columns]
        ys.append(y)
        colors.append([sum(c[i] for c in samples) / len(samples) for i in range(3)])
    n = len(ys)
    mean_y = sum(ys) / n
    var_y = sum((y - mean_y) ** 2 for y in ys)
    fits = []
    for i in range(3):
        mean_c = sum(c[i] for c in colors) / n
        slope = sum((y - mean_y) * (c[i] - mean_c) for y, c in zip(ys, colors)) / var_y
        fits.append((mean_c - slope * mean_y, slope))
    return [tuple(int(round(min(255, max(0, a + b * y)))) for a, b in fits) for y in range(img.height)]


def logo_alpha(img, rows):
    """Máscara del logo blanco: 0 en el fondo, 255 en el blanco puro."""
    px = img.load()
    left, top, right, bottom = LOGO_BOX
    mask = Image.new("L", (right - left, bottom - top), 0)
    out = mask.load()
    for y in range(top, bottom):
        bg = rows[y]
        for x in range(left, right):
            r, g, b = px[x, y]
            # El canal rojo separa mejor el blanco del verde.
            a = (r - bg[0]) / max(1, 255 - bg[0])
            out[x - left, y - top] = int(round(min(1.0, max(0.0, a)) * 255))
    return mask


def compose(size, rows, mask, logo_scale, rounded):
    src_size = len(rows)
    canvas = Image.new("RGBA", (size, size))
    for y in range(size):
        color = rows[min(src_size - 1, y * src_size // size)]
        canvas.paste(color + (255,), (0, y, size, y + 1))
    # El logo conserva la posición relativa de la imagen de origen, escalado alrededor del centro.
    left, top, right, bottom = LOGO_BOX
    factor = size / src_size * logo_scale
    w, h = round((right - left) * factor), round((bottom - top) * factor)
    cx = ((left + right) / 2 - src_size / 2) * factor + size / 2
    cy = ((top + bottom) / 2 - src_size / 2) * factor + size / 2
    logo = mask.resize((w, h), Image.LANCZOS)
    white = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    canvas.paste(white, (round(cx - w / 2), round(cy - h / 2)), logo)
    if rounded:
        corner = Image.new("L", (size * 4, size * 4), 0)
        from PIL import ImageDraw

        ImageDraw.Draw(corner).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=round(size * 4 * 0.2), fill=255)
        canvas.putalpha(corner.resize((size, size), Image.LANCZOS))
    return canvas


def write_png(path, image):
    """PNG RGBA de 8 bits, filtro 0 en cada fila."""
    width, height = image.size
    data = image.tobytes()
    raw = b"".join(b"\x00" + data[y * width * 4:(y + 1) * width * 4] for y in range(height))

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    print(path.relative_to(ROOT))


def main():
    img = Image.open(SOURCE).convert("RGB")
    rows = background_rows(img)
    mask = logo_alpha(img, rows)
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", compose(192, rows, mask, 1.0, rounded=True))
    write_png(OUT / "icon-512.png", compose(512, rows, mask, 1.0, rounded=True))
    write_png(OUT / "icon-maskable-512.png", compose(512, rows, mask, 0.8, rounded=False))
    write_png(OUT / "apple-touch-icon.png", compose(180, rows, mask, 1.0, rounded=False))
    write_png(OUT / "favicon-32.png", compose(32, rows, mask, 1.0, rounded=True))


if __name__ == "__main__":
    main()
