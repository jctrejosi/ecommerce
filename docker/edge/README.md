# `edge/` — edge compartido (el único que publica 80/443)

Cuando en el mismo servidor conviven **varios** proyectos (ecommerce + CRM) y
ninguno debe quedarse con los puertos «genéricos», este contenedor es el único
que publica **80/443**: termina TLS (Let's Encrypt) para todos los dominios y
reenvía a cada contenedor de aplicación por la red `shared_edge`.

```
Internet ── :80/:443 ──> edge (Caddy, TLS) ── shared_edge ──> mercaldas_app:8080            (ecommerce)
                                                          ├─> mercaldas_crm_app:8080        (CRM)
                                                          └─> mercaldas_astaroth_app:8080   (ML, consumo interno)
```

| Contenedor | Puertos publicados | Notas |
|---|---|---|
| `edge_caddy` | `80`, `443` | único punto de entrada; certificados en `edge_caddy_data` |
| `mercaldas_app` (ecommerce) | `127.0.0.1:30180` / `127.0.0.1:30181` | solo loopback; TLS interno desactivado |
| `mercaldas_crm_app` (CRM) | `127.0.0.1:30280` / `127.0.0.1:30281` | solo loopback; TLS interno desactivado |
| `mercaldas_astaroth_app` (Astaroth ML) | `127.0.0.1:30380` / `127.0.0.1:30381` | solo loopback; lo consume el CRM por `shared_edge` (no necesita el edge) |

## Puesta en marcha

1. **Los proyectos primero** (crean la red `shared_edge` y arrancan sin TLS):

   ```bash
   # Ecommerce (TLS=false en docker/.env)
   docker compose -f docker/docker-compose.yml up -d

   # CRM (prod.js escribe estos valores con mode=edge en prod.config.json)
   node prod.js
   ```

   En `docker/.env` de cada proyecto, en modo edge:

   ```ini
   TLS=false
   ALLOW_INSECURE=true
   PUBLIC_SCHEME=https          # el esquema PÚBLICO real (el edge hace TLS)
   PUBLIC_HTTP_PORT=127.0.0.1:30180     # ecommerce (CRM: 30280)
   PUBLIC_HTTPS_PORT=127.0.0.1:30181    # ecommerce (CRM: 30281)
   ```

2. **DNS**: todos los dominios del `Caddyfile` con registro A → IP del servidor.

3. **El edge**:

   ```bash
   cd docker/edge
   docker compose up -d
   docker compose logs -f          # busca "certificate obtained successfully"
   ```

4. **Firewall**: abre **solo** 80 y 443 (proveedor + Windows). Los puertos de los
   proyectos quedan en loopback: ni se abren ni se exponen.

## Añadir un dominio nuevo

1. Añádelo al `.env` del proyecto (`HOST_*`) y reinicia ese contenedor.
2. Añádelo al `Caddyfile` de este edge y `docker compose up -d` (Caddy recarga y
   emite el certificado).
3. Crea su registro DNS.

## Problemas comunes

| Síntoma | Causa | Arreglo |
|---|---|---|
| `network shared_edge not found` | los proyectos aún no arrancaron | levántalos primero |
| Warning `network shared_edge exists but was not created for project …` | normal: otro proyecto la creó antes | se reutiliza sin problema; ignóralo |
| `502` en un dominio | el contenedor del proyecto no está arriba o el `Host` no existe en su `.env` | revisa `docker ps` y el `.env` del proyecto |
| No emite certificado | DNS del dominio sin apuntar / 80 ocupado | `nslookup`, libera el 80 (IIS/HTTP.sys) |
| `port is already allocated` | otro proceso usa 80/443 | detén IIS u otro servidor web, o cambia `EDGE_HTTP_PORT` |
| El panel genera URLs `http://` | falta `PUBLIC_SCHEME=https` en el proyecto | ponlo y reinicia ese contenedor |

> Si algún día prefieres que un proyecto sea autónomo (sin edge), basta con
> poner en su `docker/.env` `TLS=true`, `PUBLIC_HTTP_PORT=80` y
> `PUBLIC_HTTPS_PORT=443`: su propio Caddy publicará 80/443 y emitirá TLS.
