# Despliegue en un contenedor único (`docker/`)

Imagen única con **todo el stack** de Mercaldas dentro de un solo contenedor:

| Proceso | Puerto (interno) | Acceso |
|---|---|---|
| Backend NestJS | `127.0.0.1:3100` | solo dentro del contenedor |
| Bot FastAPI | `127.0.0.1:8001` | solo dentro del contenedor |
| Caddy (proxy + TLS + estáticos) | `:80` / `:443` | **único publicado** |

Caddy enruta por **dominio/host**: cada interfaz web (build Vite) se sirve en su
subdominio y el API (backend + `/bot`) en su propio host. Los dominios/hosts se
configuran con **variables de entorno** en runtime — no hace falta reconstruir
la imagen para cambiar dominios.

> El `Dockerfile`/`Caddyfile` de la **raíz** son para Render (un solo puerto,
> rutas `/bot`, `/ia-service`). Este `docker/` es la variante multi-dominio para
> tu propio servidor. No se tocan entre sí.

## 1. Configurar

```bash
cp docker/.env.example docker/.env
#   edita docker/.env: HOST_*, TLS, ACME_EMAIL, VITE_API_URL, DATABASE_URL, secretos
```

`VITE_API_URL` debe ser la URL pública del API (`https://<HOST_API>`); se
**hornea** en los fronts al compilar, por eso también se pasa como `--build-arg`.

## 2. Construir y levantar

```bash
# VITE_API_URL debe coincidir con el de docker/.env
docker compose -f docker/docker-compose.yml build \
  --build-arg VITE_API_URL=https://api.tudominio.com

docker compose -f docker/docker-compose.yml up -d
docker compose -f docker/docker-compose.yml logs -f
```

Solo se publican `80` y `443`. Backend y bot nunca se publican: quedan en la red
`mercaldas_internal` (interna). Si `80/443` ya están ocupados en el host,
cámbialos con `PUBLIC_HTTP_PORT`/`PUBLIC_HTTPS_PORT` en `docker/.env`.

## 3. Base de datos

La BD **no** va en este contenedor. Dos opciones:

- **Externa/administrada** (Supabase, RDS…): pon su cadena en `DATABASE_URL`.
- **Contenedor de `db/docker`**: levántalo y adjúntalo a la red interna, luego
  usa `DATABASE_URL=postgres://postgres:postgres@ecommerce_postgres:5432/ecommerce`.

  ```bash
  # adjuntar el postgres existente a la red interna del stack
  docker network connect mercaldas_internal ecommerce_postgres
  ```

## 4. DNS, TLS y router

- Crea un registro **A** por cada `HOST_*` → IP pública del servidor.
- Con `TLS=true`, Caddy emite y renueva los certificados (Let's Encrypt) usando
  `ACME_EMAIL`. Necesita que `80` y `443` lleguen al servidor.
- Reenvía en el router **solo** `80` y `443` a este host. **No** expongas `3100`
  ni `8001` (son internos).

## 5. Cómo funciona el enrutado

En el arranque, `docker/entrypoint.sh` ejecuta `docker/gen-caddyfile.mjs`, que
genera `/app/Caddyfile.generated` a partir de las variables `HOST_*`:

- `HOST_API` → `/bot/*` al bot y el resto al backend.
- `HOST_WEB` → estáticos de `/srv/web`; `HOST_ADMIN` → `/srv/admin`; etc.
  (con *fallback* SPA a `index.html`).

Puedes regenerarlo y validarlo manualmente sin arrancar todo:

```bash
HOST_API=api.example.com HOST_WEB=client.example.com \
  node docker/gen-caddyfile.mjs
```

Si no defines ningún `HOST_*`, se genera un vhost `:80` mínimo (solo API) para
comprobar que el contenedor levanta; las interfaces requieren sus `HOST_*`.

## Notas

- Para cambiar un dominio basta editar `docker/.env` y `up -d` de nuevo; **no**
  hace falta rebuild salvo que cambies `VITE_API_URL` (va dentro del bundle).
- Esta carpeta se escribió sin poder ejecutar el build aquí; verifica el primer
  `build`/`up` y revisa `logs` de Caddy si algún dominio no resuelve.
