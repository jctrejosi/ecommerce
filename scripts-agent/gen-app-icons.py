#!/usr/bin/env python3
"""Genera los iconos de launcher de la app con el logo de la tienda."""
from pathlib import Path
from PIL import Image

ROOT = Path("Interface movil client/android/app/src/main/res")
LOGO = Image.open("/tmp/logo_store.png").convert("RGBA")

WHITE = (255, 255, 255, 255)

# Legacy icons (square canvas + round canvas): logo a 78% del ancho.
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

def compose(size: int, logo_ratio: float) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), WHITE)
    w = int(size * logo_ratio)
    h = int(w * LOGO.height / LOGO.width)
    logo = LOGO.resize((w, h), Image.LANCZOS)
    x = (size - w) // 2
    y = (size - h) // 2
    canvas.alpha_composite(logo, (x, y))
    return canvas

made = []
for dpi, size in LEGACY.items():
    d = ROOT / f"mipmap-{dpi}"
    for name in ("ic_launcher", "ic_launcher_round"):
        compose(size, 0.78).convert("RGB").save(d / f"{name}.webp", "WEBP", quality=95)
        made.append(f"mipmap-{dpi}/{name}.webp")

# Adaptive foreground (fondo transparente, logo a 50% dentro de la zona segura).
FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for dpi, size in FG.items():
    d = ROOT / f"mipmap-{dpi}"
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    w = int(size * 0.50)
    h = int(w * LOGO.height / LOGO.width)
    logo = LOGO.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(logo, ((size - w) // 2, (size - h) // 2))
    canvas.save(d / "ic_launcher_foreground.webp", "WEBP", quality=95)
    made.append(f"mipmap-{dpi}/ic_launcher_foreground.webp")

# Asset raíz para app.json (prebuild futuro).
asset_icon = Path("Interface movil client/assets/icon.png")
asset_icon.parent.mkdir(parents=True, exist_ok=True)
compose(1024, 0.78).convert("RGB").save(asset_icon, "PNG")

asset_fg = Path("Interface movil client/assets/adaptive-icon.png")
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
w = int(1024 * 0.50)
h = int(w * LOGO.height / LOGO.width)
canvas.alpha_composite(LOGO.resize((w, h), Image.LANCZOS), ((1024 - w) // 2, (1024 - h) // 2))
canvas.save(asset_fg, "PNG")

print(f"OK {len(made)} iconos generados:")
for m in made:
    print(" -", m)
print(" - assets/icon.png (1024)")
print(" - assets/adaptive-icon.png (1024)")
