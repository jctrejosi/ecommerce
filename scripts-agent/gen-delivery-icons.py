#!/usr/bin/env python3
"""Genera los iconos de launcher y los assets de Expo de la app de delivery.

Toma `assets/delivery.png` (el logo DMI · Última Milla, con fondo transparente)
y reescribe:

  android/app/src/main/res/mipmap-*/   (iconos reales que usa el APK)
  assets/icon.png, android-icon-*.png, favicon.png   (fuente para Expo/prebuild)

Proporciones: en el icono adaptativo el contenido debe caber en el círculo
seguro (61% del lienzo de 108dp), así que el logo se escala por altura a ~50%
del lienzo; en el icono clásico (API < 26) va más grande, ~78%.

Uso: python3 scripts-agent/gen-delivery-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
APP = RAIZ / "Interface movil delivery"
ORIGEN = APP / "assets" / "delivery.png"
RES = APP / "android" / "app" / "src" / "main" / "res"

# Fondo de marca: el mismo `iconBackground` que declara app.json.
FONDO = (230, 244, 254, 255)  # #E6F4FE

# Lienzos por densidad: clásico (48dp) y adaptativo (108dp).
CLASICO = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTATIVO = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}

ALTO_ADAPTATIVO = 0.50  # dentro del círculo seguro
ALTO_CLASICO = 0.78
ALTO_REDONDO = 0.70

logo = Image.open(ORIGEN).convert("RGBA")
caja = logo.getbbox()
if caja:
    logo = logo.crop(caja)
print(f"origen: {ORIGEN.name} {Image.open(ORIGEN).size} -> recortado {logo.size}")


def escalado(alto: int) -> Image.Image:
    """Logo escalado a esa altura, conservando proporción."""
    ancho = max(1, round(logo.width * alto / logo.height))
    return logo.resize((ancho, alto), Image.LANCZOS)


def centrar(lienzo: Image.Image, img: Image.Image) -> None:
    lienzo.alpha_composite(
        img, ((lienzo.width - img.width) // 2, (lienzo.height - img.height) // 2)
    )


def cuadrado(size: int, alto_rel: float) -> Image.Image:
    """Icono clásico: fondo de marca a sangre + logo centrado."""
    lienzo = Image.new("RGBA", (size, size), FONDO)
    centrar(lienzo, escalado(round(size * alto_rel)))
    return lienzo


def redondo(size: int, alto_rel: float) -> Image.Image:
    """Icono clásico redondo: el fondo se recorta en círculo."""
    lienzo = Image.new("RGBA", (size, size), (0, 0, 0, 0)) 
    circulo = Image.new("L", (size, size), 0)
    ImageDraw.Draw(circulo).ellipse((0, 0, size - 1, size - 1), fill=255)
    lienzo.paste(Image.new("RGBA", (size, size), FONDO), (0, 0), circulo)
    centrar(lienzo, escalado(round(size * alto_rel)))
    return lienzo


def primer_plano(size: int, alto_rel: float) -> Image.Image:
    """Capa foreground del adaptativo: solo el logo, sin fondo."""
    lienzo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    centrar(lienzo, escalado(round(size * alto_rel)))
    return lienzo


def monocromo(size: int, alto_rel: float) -> Image.Image:
    """Silueta blanca (iconos temáticos): el alfa del logo como máscara."""
    img = escalado(round(size * alto_rel))
    blanco = Image.new("RGBA", img.size, (255, 255, 255, 255))
    blanco.putalpha(img.split()[3])
    lienzo = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    centrar(lienzo, blanco)
    return lienzo


def guardar(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "WEBP", quality=95, method=6)
    print(f"  {path.relative_to(RAIZ)}  {img.size[0]}x{img.size[1]}")


print("iconos del APK (mipmap):")
for dpi, size in CLASICO.items():
    d = RES / f"mipmap-{dpi}"
    guardar(cuadrado(size, ALTO_CLASICO), d / "ic_launcher.webp")
    guardar(redondo(size, ALTO_REDONDO), d / "ic_launcher_round.webp")

for dpi, size in ADAPTATIVO.items():
    d = RES / f"mipmap-{dpi}"
    guardar(
        Image.new("RGBA", (size, size), FONDO), d / "ic_launcher_background.webp"
    )
    guardar(primer_plano(size, ALTO_ADAPTATIVO), d / "ic_launcher_foreground.webp")
    guardar(monocromo(size, ALTO_ADAPTATIVO), d / "ic_launcher_monochrome.webp")

print("assets de Expo:")
ASSETS = APP / "assets"
cuadrado(1024, ALTO_CLASICO).convert("RGB").save(ASSETS / "icon.png")
print(f"  assets/icon.png  1024x1024")
Image.new("RGBA", (1024, 1024), FONDO).save(ASSETS / "android-icon-background.png")
print(f"  assets/android-icon-background.png  1024x1024")
primer_plano(1024, ALTO_ADAPTATIVO).save(ASSETS / "android-icon-foreground.png")
print(f"  assets/android-icon-foreground.png  1024x1024")
monocromo(1024, ALTO_ADAPTATIVO).save(ASSETS / "android-icon-monochrome.png")
print(f"  assets/android-icon-monochrome.png  1024x1024")
cuadrado(64, 0.80).convert("RGB").save(ASSETS / "favicon.png")
print(f"  assets/favicon.png  64x64")

# Vista previa para revisar el resultado de un vistazo.
PREVIA = RAIZ / "scripts-agent" / ".scratch" / "icons" / "previa.png"
PREVIA.parent.mkdir(parents=True, exist_ok=True)
celdas = [
    ("adaptativo (circulo)", primer_plano(432, ALTO_ADAPTATIVO), FONDO, "circulo"),
    ("adaptativo (cuadrado)", primer_plano(432, ALTO_ADAPTATIVO), FONDO, None),
    ("clasico", cuadrado(192, ALTO_CLASICO), None, None),
    ("redondo", redondo(192, ALTO_REDONDO), None, None),
    ("monocromo", monocromo(432, ALTO_ADAPTATIVO), (32, 32, 32, 255), None),
]
ESCALA = 0.6
lado = 432
prev = Image.new("RGB", (len(celdas) * int(lado * ESCALA), int(lado * ESCALA)), (255, 255, 255))
for i, (_, capa, fondo, mascara) in enumerate(celdas):
    base = Image.new("RGBA", (lado, lado), fondo or (0, 0, 0, 0))
    base.alpha_composite(capa)
    if mascara == "circulo":
        m = Image.new("L", (lado, lado), 0)
        ImageDraw.Draw(m).ellipse((0, 0, lado - 1, lado - 1), fill=255)
        recortado = Image.new("RGBA", (lado, lado), (255, 255, 255, 255))
        recortado.paste(base, (0, 0), m)
        base = recortado
    prev.paste(base.convert("RGB").resize((int(lado * ESCALA),) * 2, Image.LANCZOS), (i * int(lado * ESCALA), 0))
prev.save(PREVIA)
print(f"vista previa: {PREVIA.relative_to(RAIZ)}")
