# Guía para agentes — Mercaldas ecommerce

Monorepo con varias interfaces, un backend NestJS, un bot de compras y un
servicio de IA. Esta guía existe, sobre todo, para **evitar que el agente
queme su ventana de contexto** en tareas sobre grandes volúmenes de datos.

## Estructura (para no explorar a ciegas)

- `backend/` — NestJS + Drizzle. Esquema en `backend/drizzle/schema.ts`.
- `Interface web client/` — tienda (React + Vite).
- `Interface web admin/` — panel admin (React + Vite).
- `bot/` — chatbot de compras (FastAPI + DeepSeek function calling).
- `ia-service/` — generación de contenido de campañas (FastAPI + DeepSeek).
- `db/`, `db-campaigns/` — scripts de datos y migraciones (`.mjs`).
- Otras interfaces: `delivery`, `picking`, `analytics`, etc.

## Reglas de contexto (obligatorias)

1. **Nunca leer completos los archivos gigantes/autogenerados.** En especial:
   - `backend/drizzle/schema.ts` (~3.4k líneas)
   - `Interface web admin/src/imports/example.tsx` (~3k líneas)
   Usa `grep` para ubicar el símbolo y luego `read_file` con `start_line`/`end_line`.
2. **Nunca traer lotes grandes de filas al chat** (productos, clientes, pedidos,
   inventario). Si necesitas operar sobre muchas filas, **escribe un script** en
   `/scripts-agent/*.ts` y ejecútalo con `terminal`. Del
   script solo debe volver un resumen (conteos, muestra corta, errores).
3. **Acota la salida de comandos** con `head_lines`/`tail_lines`. No vuelques
   listados enteros.
4. **Una tarea por sesión.** Si la conversación ya es muy larga, propón empezar
   una nueva sesión enfocada en el siguiente subproblema.
5. **Delega la exploración pesada en subagentes.** Su contexto queda aislado y
   solo te devuelven el resumen que pides.
6. Antes de una operación masiva, **confirma la regla de mapeo** (qué producto va
   a qué cosa) para codificarla en SQL/script, en lugar de decidir fila por fila.

## Asociaciones de catálogo (operación típica)

- Producto → **Tipo de Producto**: tabla `product_type_assignments`
  (`product_id`, `product_type_id`, PK compuesta). Reemplaza asignaciones previas
  del producto (`assignProductType` en `backend/scripts/import-products-from-json.ts`).
  API admin: `POST /admin/catalog/product-types/:id/products`.
- Producto → **Categoría**: tabla `product_categories`
  (`assignProductCategory` en el mismo script). API:
  `POST /admin/catalog/categories/:id/products`.

Estas operaciones se hacen **por script/SQL**, nunca pasando el catálogo por el chat.
