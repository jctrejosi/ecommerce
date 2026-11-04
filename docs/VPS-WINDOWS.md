# Despliegue en el VPS Windows (`170.254.229.68`)

Estado de este servidor: **Windows Server 2022**, IP pública NAT-eada (la NIC
tiene `172.30.85.x`), dominio `jcti.xyz` en GoDaddy
(`ns03/ns04.domaincontrol.com`). El ecommerce corre en un **contenedor único**
(`mercaldas_app`) y el borde TLS en `edge_caddy`.

## Arquitectura real

- El motor Docker **no** es Docker Desktop: vive en una distro **WSL Ubuntu**
  propia, con `systemd` y la API en `127.0.0.1:2375` (solo loopback).
- `edge_caddy` publica `80/443` dentro de WSL. Windows los publica al exterior
  con `netsh interface portproxy` hacia la IP de WSL.
- La IP de WSL cambia al reiniciar; por eso hay tareas programadas que la
  recalculan.

| Tarea programada | Principal | Función |
|---|---|---|
| `MercaldasDockerEngine` | `Desarrolo4` (S4U), al inicio y cada minuto | mantiene `wsl -d Ubuntu ... sleep infinity` (systemd + Docker) |
| `MercaldasPortProxy` | `Desarrolo4` (S4U), al inicio y cada 5 min | reescribe `portproxy` 80/443 con la IP actual de WSL |

Docker Desktop quedó **deshabilitado** (autostart eliminado): se detenía al
cerrar la sesión RDP y dejaba el motor caído.

## Operación diaria

```powershell
cd C:\Users\Desarrolo4\Documents\ecommerce

.\prod.cmd --status     # estado de mercaldas_app
.\prod.cmd --logs       # logs en vivo
.\prod.cmd --with-db    # reconstruye/levanta y conecta PostgreSQL
.\prod.cmd --stop       # detiene el contenedor
```

`prod.cmd` ejecuta `prod.js` **dentro de WSL** (los compose usan bind mounts
que solo resuelven con rutas Linux). No ejecutes `node prod.js` con Node de
Windows en este servidor.

Comprobaciones rápidas:

```powershell
wsl -l -v
wsl -d Ubuntu -u root -- systemctl status docker
wsl -d Ubuntu -u root -- docker ps
netsh interface portproxy show v4tov4
```

## Pendiente para terminar de exponer: DNS en GoDaddy

En **GoDaddy → jcti.xyz → DNS** (TTL 600):

1. **Borra el CNAME `mercaldas`** que hoy apunta a
   `mercaldas-ecommerce-…vercel.app` (Vercel). Si no se borra, el tráfico nunca
   llega a este servidor.
2. Crea estos registros **A → `170.254.229.68`**:

| Nombre | Valor |
|---|---|
| `mercaldas` | `170.254.229.68` |
| `api.mercaldas` | `170.254.229.68` |
| `admin.mercaldas` | `170.254.229.68` |
| `picking-admin.mercaldas` | `170.254.229.68` |
| `delivery-admin.mercaldas` | `170.254.229.68` |

No crees `picking.mercaldas` (no se sirve). `ml.mercaldas` es opcional y se
descomenta en `docker/edge/Caddyfile` cuando Astaroth esté desplegado.

Astaroth, Paimon y WhatsApp Bot se publican en dominios propios bajo
`jcti.xyz` (no bajo `mercaldas`): `astaroth`, `paimon` y `bot-platform`.
Detalle completo en [`SERVICIOS-ADICIONALES-VPS.md`](./SERVICIOS-ADICIONALES-VPS.md).

El servidor tiene además **Ollama con GPU** (Tesla P100) para modelos locales:
ver [`OLLAMA-VPS-WINDOWS.md`](./OLLAMA-VPS-WINDOWS.md).

Verificación:

```bash
nslookup api.mercaldas.jcti.xyz      # debe devolver 170.254.229.68
curl -I https://api.mercaldas.jcti.xyz/api-status
```

Caddy reintenta ACME cada pocos minutos; en cuanto el DNS propague emitirá los
certificados de **Let's Encrypt producción** (el Caddyfile fija `acme_ca`
explícitamente). Revisa el avance con:

```powershell
wsl -d Ubuntu -u root -- docker logs --tail 30 edge_caddy
```

## Seguridad aplicada

- Único punto de entrada: **TCP 80 y 443** (redirigidos al edge). El resto de
  puertos del proyecto son loopback (`127.0.0.1:30180/30181`) o redes internas.
- API Docker solo en `127.0.0.1:2375`; no expuesta.
- PostgreSQL accesible solo en `127.0.0.1:5432` y `mercaldas_internal`.
- Paneles y `/bot` con Basic Auth: `401` sin credenciales, `200` con ellas.
  Las credenciales están en `docker/.env` (`ADMIN_PASSWORD`).
- **WinRM (5985) bloqueado** desde internet con regla de firewall.
- TLS con HSTS en el edge; HTTP redirige a HTTPS (`308`).
- Rate limit del backend por IP real (`TRUST_PROXY=loopback,uniquelocal`).

Riesgos residuales del host (fuera del contenedor): RDP `3389` sigue público
(recomendado restringirlo por IP/VPN) y siguen abiertos puertos heredados
`5002` (XAMPP), `6262` (Advantage DB), `8501` y `19955`. Ciérralos si no se usan
externamente.

## Base de datos

- Contenedor `ecommerce_postgres` (PostGIS 16), volumen `db_postgres_data`.
- Respaldo restaurado en este despliegue:
  `db/backups/ecommerce/backup_2026-10-08` (`products=21613`, `orders=98`).
- Restaurar un respaldo: `db/backups/ecommerce/backup_*/restore.ps1` con
  `DOCKER_HOST=tcp://127.0.0.1:2375` y el CLI `C:\DockerCLI\docker.exe`.
- La BD del motor anterior (Docker Desktop) no se migró: quedó en su VHDX. Si
  se necesita el dato más reciente, hay que iniciar Docker Desktop en una sesión
  de `Desarrolo4`, volcar con `pg_dump -Fc` y restaurar en el motor nuevo.
