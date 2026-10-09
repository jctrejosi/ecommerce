# Runbook — conectar y operar la sincronización con el ERP

Guía para montar el ecommerce junto al ERP (Advantage) y dejar la
sincronización corriendo. Diseño y alcance: `PLAN-SINCRONIZACION-ERP.md`.

---

## 1. Componentes

```
Ecommerce (backend + interfaces) ── Postgres (ecommerce)
                                        ▲
                                        │  scripts-agent/erp/*.mjs
                                        ▼
                                 OpenADS (Docker) ── base Advantage del ERP
```

- **Postgres** del ecommerce: contenedor `ecommerce_postgres` (:5432).
- **OpenADS**: contenedor `openads-img` (:18080 HTTP, :16262 wire) montando
  `db/ads/openads/data` como `/data`. Es el puente hacia Advantage.
- **Scripts de sync**: `scripts-agent/erp/`.

## 2. Puesta en marcha

```bash
node dev.js                 # levanta Postgres + OpenADS (y siembra si falta)
node scripts-agent/erp/init-db.mjs   # crea las tablas erp_* (idempotente)
```

Si OpenADS no tiene las tablas del ERP, cópialas a `db/ads/openads/data/`
(desde `db/ADD_ANALITICA/`). Las que usa el ecommerce:
`tidsal`, `tidtab`, `tidcate`, `tidtpro`, `tidmarcas`, `tidbode`,
`pospago`, `posdane`, `poscli`. (Y `faddia`/`fapago` sólo si usas el espejo
opcional `sync-invoices.mjs --full`.)

## 3. Variables de entorno

Las lee el backend y los scripts (vía `backend/.env.development.local`):

| Variable | Defecto | Uso |
|---|---|---|
| `OPENADS_URL` | `http://localhost:18080` | **aquí se cambia al montar en el ERP** |
| `OPENADS_USER` / `OPENADS_PASS` | `dsi` / `dsi` | credenciales de OpenADS |
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/ecommerce` | Postgres del ecommerce |
| `ADMIN_USER_ID` | `1` | auditoría de precios |

> **Montaje en el ERP real**: basta apuntar `OPENADS_URL` a la IP/puerto donde
> corra OpenADS (o `localhost` si es la misma máquina).

## 4. Sincronización

```bash
# Todo en modo seguro (trae del ERP; muestra lo que haría hacia el ERP)
node scripts-agent/erp/sync-all.mjs

# Todo, incluyendo escrituras hacia el ERP
node scripts-agent/erp/sync-all.mjs --apply
```

Pasos que corre `sync-all`:
`sercodes → sync-catalog → sync-customers → push-customers → push-catalog →
push-orders → reconcile`.

Scripts individuales y su sentido: ver `scripts-agent/erp/README.md`.

## 5. Automatización

### Linux (cron)
```cron
*/5 * * * * cd /ruta/ecommerce && node scripts-agent/erp/sync-all.mjs --apply >> /var/log/erp-sync.log 2>&1
```

### Windows (donde vive el ERP)
- **Task Scheduler**: tarea cada N minutos que ejecute
  `node C:\ruta\ecommerce\scripts-agent\erp\sync-all.mjs --apply`.
- Como servicio: envolver con [NSSM](https://nssm.cc/) o `sc.exe` si se quiere
  el agente (y `node dev.js`) siempre arriba.

> Fase futura (tiempo real): triggers `DSI_EVENTO` en el ERP + endpoints
> `/erp/*` en el backend, para no depender del intervalo del cron.

## 6. Problemas comunes

| Síntoma | Causa / solución |
|---|---|
| `ECONNREFUSED :18080` | OpenADS caído → `docker start openads-img` |
| `AdsOpenTable failed` / `could not find ... .dbf` | Falta la tabla en `db/ads/openads/data` (copiar `.adt`+`.adi`) |
| "authentication required" en el navegador | entrar con `http://localhost:18080/?_auth_user=dsi&_auth_pass=dsi` |
| Sync no ve cambios | el contenedor montó un `/data` distinto; revisar el bind mount |

## 7. Pendientes para producción

- **`CODCLI`**: hoy `push-customers.mjs` lo genera (`2999########`). Confirmar
  con el ERP su algoritmo real.
- **Enums** (§11 del plan de integración): `FAESTADO`/`IFESTADO`, `FATIPODOM`,
  `FACANALV`, `FADOCPAGO`.
- **Stock**: `push-catalog.mjs` pisa `INSALDO00`; lo correcto suele ser enviar
  **movimientos** de inventario.
- **Conflictos de propiedad**: definir quién gana cuando ambos editan
  (el campo de precio/stock se escribe en ambos sentidos).
