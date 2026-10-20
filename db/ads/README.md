# Mercaldas — ADS (Advantage Database Server) en Docker

> ✅ **Resuelto sin el instalador de SAP: usar `db/ads/openads/`.**
> El instalador `adslinux-11.10.0.24.tar.gz` no existe públicamente (producto
> descontinuado por SAP en dic-2022), pero **OpenADS** (reimplementación
> open-source, Apache-2.0) lee/escribe los `.adt` nativos de forma
> byte-compatible y corre en Linux. Ya está validado contra `db/ADD_ANALITICA`:
> ver `docs/OPENADS-VALIDACION.md` y `db/ads/openads/README.md`.
>
> Lo que sigue en este documento es el **plan original** (servidor oficial de
> SAP), conservado solo como contexto histórico.

## Plan original (obsoleto): servidor ADS oficial de SAP

Corre la base **Publidata** (`db/ADDT`) con el servidor ADS en un contenedor.

## 1. Preparar los datos (una vez)

El servidor ADS escribe archivos de bloqueo/índice, así que **no se monta
`db/ADDT` directamente** (no queremos tocar la copia original):

```sh
mkdir -p db/ads/data db/ads/installers
cp -r db/ADDT/. db/ads/data/          # copia de trabajo
```

## 2. Colocar el instalador

```sh
# Copia el archivo aquí (NO se sube a git: está ignorado):
#   db/ads/installers/adslinux-11.10.0.24.tar.gz
```

## 3. Ajustar el Dockerfile a la realidad del tarball

El bloque de instalación en `db/ads/Dockerfile` está marcado con `AJUSTAR`:
extrae el tarball, mira su `INSTALL`/`README` y ajusta el `RUN` de
instalación (suele ser un `install.sh` interactivo) y el `CMD` del daemon.

## 4. Construir y correr

```sh
cd db/ads
docker compose up -d --build
docker compose logs -f ads        # hasta ver el daemon arrancado
```

## 5. Conectar

| Dato | Valor |
|---|---|
| Server | `localhost` |
| Puerto | `6262` (y `2000` como alterno) |
| Base / DataDirectory | `PUBLIDATA.add` dentro de `/data` |
| Usuario / password | los del diccionario (`AdsSys` / `Pubdata` por defecto) |

Un cliente que soporte ADS (o el driver ODBC de Advantage en Windows) apunta
a `localhost:6262` con `DataDirectory=<ruta a PUBLIDATA.add>`.

## Notas

- **Permisos**: el daemon corre como su usuario propio (`advantage`); si no
  puede escribir en `/data`, usa `chown -R` dentro del contenedor.
- **Compatibilidad**: si el diccionario se mantuvo con un ADS más nuevo que
  el 11.10, este servidor podría rechazarlo.
- **Archivos ignorados**: `db/ads/installers/` y `db/ads/data/` no se suben
  a git (el instalador es software con licencia y los datos son de producción).
