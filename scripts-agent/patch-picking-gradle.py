"""Conecta el proyecto Android nativo del picking con Firebase.

`android/` está en .gitignore (lo genera `expo prebuild`), así que este cambio se
hace por script en lugar de a mano: copia google-services.json y añade el plugin
de Google Services, que es lo que inicializa el SDK de Firebase para el push.
"""
import pathlib
import shutil

ROOT = pathlib.Path("/home/jk/Proyectos/dsi/ecommerce/Interface movil picking")

# 1) El SDK lee android/app/google-services.json.
shutil.copyfile(ROOT / "google-services.json", ROOT / "android/app/google-services.json")

# 2) classpath del plugin en el build.gradle de la raíz.
root_gradle = ROOT / "android/build.gradle"
text = root_gradle.read_text()
if "google-services" not in text:
    text = text.replace(
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')",
        "classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')\n"
        "    classpath('com.google.gms:google-services:4.4.4')",
    )
    root_gradle.write_text(text)

# 3) Aplicar el plugin en el módulo app.
app_gradle = ROOT / "android/app/build.gradle"
text = app_gradle.read_text()
if "com.google.gms.google-services" not in text:
    app_gradle.write_text(
        text.rstrip() + "\n\napply plugin: 'com.google.gms.google-services'\n"
    )

print("google-services.json copiado y plugin aplicado")
