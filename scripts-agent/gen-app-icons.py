#!/usr/bin/env python3
"""
Genera los iconos de la app y los favicons de la web del cliente con el logo de
la tienda configurado en el admin.

El logo (un logotipo ancho, ~3.3:1) se descarga de `settings.general_logo` y se
deposita en `/tmp/logo_store.png` antes de ejecutar esto.
"""
from pathlib import Path
from PIL import Image

ROOT = Path("Interface movil client/android/app/src/main/res")
LOGO = Image.open("/tmp/logo_store.png").convert("RGBA")

WHITE = (255, 255, 255, 255)
# Fondo transparente para los favicons: el logo ya trae alfa y aplanarlo sobre
# blanco deja un marco visible en la pestaña.
TRANSPARENT = (255, 255, 255, 0)

# Legacy icons (square canvas + round canvas): logo a 78% del ancho.
# El logo de la tienda (configurado en el admin) es un logotipo ancho (~3.3:1),
# así que ocupa casi todo el ancho para que se lea en el launcher.
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}

# Anchos del logo como fracción del lienzo.
LEGACY_RATIO = 0.88
# En el icono adaptativo el área segura es ~61% del lienzo (círculo), así que un
# logotipo ancho no debe pasar de ese ancho.
FOREGROUND_RATIO = 0.58

def compose(size: int, logo_ratio: float, background=WHITE) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), background)
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
        compose(size, LEGACY_RATIO).convert("RGB").save(d / f"{name}.webp", "WEBP", quality=95)
        made.append(f"mipmap-{dpi}/{name}.webp")

# Adaptive foreground (fondo transparente, logo a 50% dentro de la zona segura).
FG = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
for dpi, size in FG.items():
    d = ROOT / f"mipmap-{dpi}"
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    w = int(size * FOREGROUND_RATIO)
    h = int(w * LOGO.height / LOGO.width)
    logo = LOGO.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(logo, ((size - w) // 2, (size - h) // 2))
    canvas.save(d / "ic_launcher_foreground.webp", "WEBP", quality=95)
    made.append(f"mipmap-{dpi}/ic_launcher_foreground.webp")

# Asset raíz para app.json (prebuild futuro).
asset_icon = Path("Interface movil client/assets/icon.png")
asset_icon.parent.mkdir(parents=True, exist_ok=True)
compose(1024, LEGACY_RATIO).convert("RGB").save(asset_icon, "PNG")

asset_fg = Path("Interface movil client/assets/adaptive-icon.png")
canvas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
w = int(1024 * FOREGROUND_RATIO)
h = int(w * LOGO.height / LOGO.width)
canvas.alpha_composite(LOGO.resize((w, h), Image.LANCZOS), ((1024 - w) // 2, (1024 - h) // 2))
canvas.save(asset_fg, "PNG")

# Favicons de la web del cliente: el mismo logo, para que la pestaña del
# navegador no quede con un logo viejo.
WEB = Path("Interface web client/public")
WEB.mkdir(parents=True, exist_ok=True)
for name, size in {"favicon.png": 192, "apple-touch-icon.png": 180}.items():
    compose(size, LEGACY_RATIO, TRANSPARENT).save(WEB / name, "PNG")
    made.append(f"public/{name}")

print(f"OK {len(made)} iconos generados:")
for m in made:
    print(" - ", m)
print(" - assets/icon.png (1024)")
print(" - assets/adaptive-icon.png (1024)")
