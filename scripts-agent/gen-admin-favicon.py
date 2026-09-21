#!/usr/bin/env python3
"""
Genera el favicon del panel admin con el logo `tienda.png`.

El logo es vertical (127×199), así que se encaja por el lado más restrictivo
para que no se salga del lienzo cuadrado. El fondo queda **transparente**: el
logo ya trae alfa y aplanarlo sobre blanco deja un marco en la pestaña.

Uso (desde la raíz del repo):
    python3 scripts-agent/gen-admin-favicon.py
"""
from pathlib import Path
from PIL import Image

ADMIN = Path("Interface web admin")
LOGO = Image.open(ADMIN / "src" / "assets" / "tienda.png").convert("RGBA")
OUT = ADMIN / "public"

TRANSPARENT = (255, 255, 255, 0)
# Fracción del lienzo que ocupa el logo en su lado más grande.
RATIO = 0.86


def compose(size: int) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), TRANSPARENT)
    max_side = int(size * RATIO)
    w = max_side
    h = int(w * LOGO.height / LOGO.width)
    if h > max_side:
        h = max_side
        w = int(h * LOGO.width / LOGO.height)
    logo = LOGO.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(logo, ((size - w) // 2, (size - h) // 2))
    return canvas


OUT.mkdir(parents=True, exist_ok=True)
favicon = OUT / "favicon.png"
compose(192).save(favicon, "PNG")
print(f"OK {favicon} (192×192) a partir de {ADMIN / 'src' / 'assets' / 'tienda.png'}")
