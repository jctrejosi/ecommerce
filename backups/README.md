# Respaldos de la base (solo datos)

`node dev.js --backup-db` deja aquí un volcado `pg_dump -Fc` de la base
`ecommerce`, **sin** las imágenes de `db/images_static/` (viven en disco y pesan
varios GB, así que no entran en el volcado).

- `ecommerce_<AAAA-MM-DD_HHmm>.dump` — volcado binario
- `ecommerce_<AAAA-MM-DD_HHmm>.dump.sha256` — suma para verificar integridad

## Restaurar

```powershell
node dev.js --restore-db                    # el respaldo más reciente de backups/
node dev.js --restore-db=backups\xxx.dump   # un respaldo concreto
```

O desde el lanzador:

```powershell
.\Activar-Desarrollo.bat -RestoreDb   # restaura y arranca los servicios
.\Activar-Desarrollo.bat -BackupDb    # crea un respaldo y sale
```

`--restore-db` borra y recrea la base (`drop database ... with (force)`), así que
la deja **exactamente** como el respaldo, sin tablas o columnas que hayan surgido
después.

## Notas

- Las imágenes **no** se respaldan: se sirven desde `db/images_static/` (o desde
  Cloudinary si está configurado). Si el equipo de destino no tiene la carpeta,
  las URLs siguen válidas pero no muestran la foto local.
- Los `.dump` son binarios grandes. Si no quieres que viajen por git, agrega
  `*.dump` al `.gitignore` de esta carpeta y copia el archivo por otra vía; si sí
  quieres que lleguen con un `git pull`, commitea solo el que vayas a distribuir
  y borra los anteriores para no inflar el historial.
