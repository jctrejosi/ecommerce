# MercAldas Shopping Bot

Chatbot de compras para el ecommerce MercAldas. Corre en **Python (FastAPI)**,
usa la **API de DeepSeek con function calling** y **consulta/escribe directamente
la base de datos** (misma BD del backend NestJS) para buscar productos y armar
el carrito de compras del cliente.

Solo ejecuta acciones programadas (tool calling): busca productos, arma el
carrito, lo consulta, lo modifica y lo finaliza. Nunca inventa datos.

## Arquitectura

```
bot/
├── app/
│   ├── main.py       # API FastAPI (/chat, /health, /chat/options)
│   ├── config.py     # Variables de entorno
│   ├── database.py   # Queries del catálogo (productos, variantes, stock)
│   ├── cart.py       # Operaciones de carrito invitado (guest_sessions/carts/cart_items)
│   ├── tools.py      # Definición de herramientas + handlers + opciones rápidas
│   └── deepseek.py   # Cliente DeepSeek + loop de function calling
├── requirements.txt
├── render.yaml       # Blueprint para Render
├── dev.sh            # Uvicorn con reload
└── .env.example
```

## Endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/health` | Estado del servicio y la BD |
| GET  | `/chat/options` | Opciones rápidas que muestra el widget |
| POST | `/chat` | Conversación: `{message, session_id?, branch_id?, history?}` → `{reply, session_id, payload}` |
| GET  | `/cart?session_id=` | Carrito actual de la sesión (modal del web client) |
| POST | `/cart/items` | Agrega (incrementa) un producto: `{session_id, product_id, quantity?}` |
| POST | `/cart/items/set` | Fija cantidad exacta (0 lo elimina): `{session_id, product_id, quantity}` |
| GET  | `/catalog/search?query=&limite=` | Búsqueda de productos para el modal (opciones seleccionables) |

El `payload` de `/chat` es estructurado para el frontend:

```json
{
  "reply": "Encontré estos productos...",
  "session_id": "uuid",
  "payload": {
    "products": [ { "product_id": 123, "name": "...", "price": 4500, "image": "...", ... } ],
    "cart": { "session_id": "...", "items": [...], "count": 3, "total": 13500 },
    "checkout": true
  }
}
```

## Herramientas (function calling)

| Función | Qué hace |
|---------|----------|
| `armar_carrito` | Arma el carrito con una lista de productos: mejor coincidencia de cada uno, **uno por ítem**, agregado directo (ej: "necesito arroz, fríjoles y lentejas") |
| `armar_lista_sugerida` | Deja una lista sugerida de base en el carrito (ofertas primero) |
| `buscar_productos` | Busca en el catálogo por nombre/marca/categoría |
| `ver_producto` | Detalle de un producto (precio, stock, imágenes) |
| `agregar_al_carrito` | Agrega (o incrementa) un producto al carrito de la sesión |
| `ver_carrito` | Estado actual del carrito |
| `quitar_del_carrito` | Reduce o elimina un producto del carrito |
| `vaciar_carrito` | Vacía el carrito |
| `finalizar_compra` | Resumen final → el cliente paga en el sitio |

## Desarrollo local

```bash
cd bot
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp .env.example .env   # pon DATABASE_URL (local o Supabase) y DEEPSEEK_API_KEY
./dev.sh               # http://localhost:8000  (docs en /docs)
```

La BD local se levanta con `cd db/docker && docker compose up -d`
(`postgresql://postgres:postgres@localhost:5432/ecommerce`).

## Despliegue (Render)

1. Crea un servicio *Web Service* apuntando a `jctrejosi/mercaldas-ecommerce`,
   root directory `bot`, o usa `render.yaml` (blueprint).
2. Variables de entorno:
   - `DATABASE_URL` → pooler de Supabase (`postgresql://postgres.<ref>:<pass>@aws-0-<region>.pooler.supabase.com:5432/postgres`)
   - `DB_SSL=true`
   - `DEEPSEEK_API_KEY`
   - `CORS_ORIGIN` → `https://mercaldas.jcti.xyz,https://mercaldasadm.jcti.xyz`
3. En el web client define `VITE_BOT_API_URL=https://<tu-bot>.onrender.com`.

## Notas

- El carrito se guarda por `session_id` (uuid que genera el web client y
  persiste en localStorage). Es un carrito de **invitado**; si el cliente ya
  tiene sesión, puede usar el botón "Usar este carrito" para cargarlo en su
  carrito del sitio y pagar normalmente.
- El bot valida stock contra `inventory` antes de agregar.
- `unaccent` no se usa: la búsqueda es `ILIKE` simple (sin tildes en el
  término puede no matchear "Lácteos"). Mejora futura: normalizar acentos.
