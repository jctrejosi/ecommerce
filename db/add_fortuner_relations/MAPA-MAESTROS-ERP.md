# Mapa de maestros ERP (Advantage) → Postgres

Estado a 2026-10-23. Complementa `docs/PLAN-SINCRONIZACION-ERP.md` (visión general) y
`db/add_fortuner_study/` (diccionario de las 111 tablas del ERP).

> **F1 implementada** (`scripts-agent/erp/sync-masters.mjs`): pull en vivo de marcas,
> tipos, categorías y bodegas con upsert por código + renombre; se corre en el ciclo
> del demonio. **F2 implementada** (`sync-catalog.mjs`): impuestos `TIDTIPOS` →
> `tax_rates` en vivo + `INTIMP → tax_rate_id` dinámico. Faltan las decisiones de §5
> para las bajas (`--prune`), el nombre de bodega (`TIDBODE` vs `TIDSUCUR`) y los
> tipos activos (`--types-active=erp`).

**Decisión de partida:** las tablas de Advantage son la **fuente principal** de los
maestros (producto, marca, tipo, categoría, impuesto, bodega). Postgres es dueño del
**contenido web** (imágenes, descripciones largas, banners, popups, colecciones, SEO) y
de los ajustes de publicación.

---

## 1. Cómo funciona hoy el producto (pipeline real)

`erp-daemon.mjs` cada **5 min** (pull) y **30 s** (push):

```
TIDSAL (Advantage)
   │  SELECT de 36 columnas, paginado por offset (PAGE=5000)
   ▼
agrupa por INARTIC  →  21.613 artículos (51.938 filas = artículo × bodega)
   │
   ├─ huella sha1 por fila:  key = INSUC|INBODEGA|INARTIC
   ├─ compara con erp_snapshot  →  solo artículos con alguna fila cambiada
   ▼
UPSERT en Postgres (SET app.erp_sync='on' para que los triggers NO reencolen)
   ├─ products               (external_id = INARTIC, merge COALESCE: lo que el ERP trae NULL no pisa lo local)
   ├─ product_variants       (sku = INARTIC; precio/compare/costo/dimensiones)
   ├─ prices                 (por variante + sucursal: INVRVENTA1 / INVRVENTA0)
   ├─ inventory              (INSALDO00, INMINIMO, INMAXIMO, INPTOPOS)
   ├─ branch_products        (INWEB → is_public, INACTIVO='A' → is_available)
   └─ relaciones (se borran y se recrean para los productos tocados):
        product_categories, product_type_assignments, product_tax_classes, product_attributes
   ▼
erp_snapshot (hash por fila)
```

Mapeo de campos (real, verificado):

| ERP | Destino |
|---|---|
| `INARTIC` | `products.external_id`, `product_variants.sku` |
| `INNOMBRE` / `INNOMBRE3` / `INNOMBRE4` | `products.name` + atributos `nombre-corto`, `nombre-largo` |
| `INEAN` | `product_variants.barcode` (duplicados → `NULL`) |
| `INVRVENTA1` / `INVRVENTA0` | `prices.price` / `prices.compare_price` (y el "actual" de la variante) |
| `INSALDO00` | `inventory.stock` |
| `INPTOPOS` / `INMINIMO` / `INMAXIMO` | `inventory.reorder_point` / `minimum_stock` / `maximum_stock` |
| `INVRULTC` (o `INCOSTO00`) | `product_variants.cost_price`, `prices.cost` |
| `INMARCAP` | `brands.name` (nombre real de la marca) |
| `INMARCA` | solo atributo `marca-erp` (no se usa como FK) |
| `INTIPO` | `product_type_assignments` |
| `INCATE` → si no sirve, **prefijo del SKU** | `product_categories` |
| `INTIMP` (leído en vivo de `TIDTIPOS`) | `product_tax_classes` |
| `INLARGO` / `INANCHO` / `INALTO` | `product_variants.*_mm` (×10) |
| `INUNIDAD`, `INPRESEN`, `INEMBALAJE`, `INPARTE`, `ININVIMA`, `INCUM`, `INUBIC`, `INEAN14` | `product_attributes` |

Sentido inverso (`erp_outbox` → `push-catalog.mjs`): precios, stock, marcas,
categorías, tipos, datos de producto, flags de publicación y estado de pedido.

**Clave del diseño:** la huella + `erp_snapshot` evita reescribir 21.613 productos cada
5 minutos. Ese mecanismo **solo existe para `TIDSAL`**.

---

## 2. Mapa completo de maestros

Leyenda de estado: ✅ sincronizado · ⚠️ sincroniza a medias · ❌ no sincroniza.

| Entidad Postgres | Tabla(s) PG | Fuente ERP | Sentido | Estado |
|---|---|---|---|---|
| Producto / variante | `products`, `product_variants` | `TIDSAL` | ⇄ | ✅ pull con huella + push |
| Precio por sucursal | `prices` | `TIDSAL.INVRVENTA1/0` | ⇄ | ✅ |
| Inventario | `inventory` | `TIDSAL.INSALDO00/MINIMO/MAXIMO/PTOPOS` | ⇄ | ✅ |
| Disponibilidad por sucursal | `branch_products` | `TIDSAL.INWEB` / `INACTIVO` | ⇄ | ✅ |
| Atributos de producto | `attributes`, `product_attributes` | columnas de `TIDSAL` | ← | ✅ |
| **Marca** | `brands` | `TIDMARCAS` + `TIDSAL.INMARCAP` | ← ⚠️ → | ✅ `sync-masters` en vivo (upsert por código + renombre) |
| **Tipo de producto** | `product_types` | `TIDTPRO` | ← ⚠️ → | ✅ `sync-masters` + `--types-active=erp` (el ERP manda `HABILITA`) |
| **Categoría** | `categories`, `product_categories` | `TIDTAB` (231 nodos) | ← ⚠️ → | ✅ upsert por código + renombre + re-parent (solo crea en `sync-catalog`) |
| **Impuesto** | `tax_rates`, `product_tax_classes` | `TIDTIPOS` (`CLASE='IM'`) | ← | ✅ F2: upsert en vivo de `tax_rates` + `INTIMP → tax_rate_id` |
| **Bodega / sucursal** | `branches` | `TIDBODE` (3: 1, 2, 11) | ← | ✅ `sync-masters` por `TIDBODE.CODIGO`/`NOMBRE` (CENTRO, SULTANA, PALERMO) |
| Cliente | `customers` | `POSCLI` (146.371) | ⇄ | ✅ |
| Pedido | `orders`, `order_items` | `DOMDIA` / `DOMITE` | → | ✅ push + `reconcile` |
| Factura / pago | `invoices`, `payments` | `FADDIA` / `FAPAGO` | ← | ✅ conciliación |
| Medio de pago | `erp_code_map` (`payment_method`) | `POSPAGO` | ← | ⚠️ estático (52 códigos de `.ADT`) |
| Estado de pedido | `erp_code_map` (`order_status`) | `DOMDIA.FAESTADO` | ↔ | ✅ |
| Proveedor | `suppliers`, `supplier_products` | `TIDLISTA.INPROVEE` + `CONTERCE` | ← | ✅ `sync-suppliers.mjs` (manual/bajo demanda; 1.587 proveedores + ~18k relaciones) |
| Vendedor | — | `VEDVEN` | — | ❌ no existe |
| Rutas de reparto | — | `RUTAENC` (5) / `RUTAITEM` (35) | — | ❌ (delivery tiene lo suyo) |
| Promociones / descuentos | — | `POSDCTOS` (5.566), `POSDCTO2`, `POSDCTO5` | — | ❌ no se traen |
| Listas de precio 2..10 | — | `TIDSAL.INVRVENTA2..9` | — | ⚠️ decisión: hoy solo se usa la 1 |
| Góndola / ubicación | atributo `ubicacion-bodega` | `TIDSAL.INUBIC`, `TIDGON` (15) | ← | ⚠️ parcial |
| Unidad de medida | atributo `unidad-medida` | `TIDSAL.INUNIDAD` (texto) | ← | ⚠️ texto libre |
| Ciudad | `branches.city` fijo "Manizales" | `POSDANE` **no** sirve (guarda EAN basura) | — | ❌ sin fuente; `FADCLI.CCIUDAD` es texto libre |

---

## 3. Defectos encontrados (con evidencia)

1. **Marcas y tipos se leen de copias `.ADT`, no de la base.**
   `sync-catalog.mjs` toma marcas/tipos de `erp_code_map`, que llena `sync-codes.mjs`
   desde `db/ads/fortuner-dicts/*.ADT`. Ese directorio quedó desfasado y el demonio
   **no** ejecuta `sync-codes`:

   | dominio | `erp_code_map` | ERP real |
   |---|---:|---:|
   | `brand` | 2.176 | 2.175 |
   | `warehouse` | **29** | **3** |
   | `product_type` | 363 | 363 |

2. **El pull de maestros solo crea, nunca actualiza.**
   ```js
   if (categoryIdByCode.has(code)) continue;   // renombre del ERP: se ignora
   if (typeIdByCode.has(code)) continue;       // ídem
   ```
   Las marcas se buscan **por nombre**, así que un renombre en `TIDMARCAS` crea una
   marca nueva y deja la vieja huérfana (hoy hay 3.473 marcas para 2.175 + 2.621
   nombres distintos de `INMARCAP`).

3. **No existe propagación de bajas.** Ni categorías, ni marcas, ni tipos, ni
   productos desactivados en el ERP se reflejan. `TIDTPRO.HABILITA` y
   `TIDCATE.HABILITA` no se leen; en PG hay 367 tipos y solo 6 activos (ajuste manual).

4. **`branches` se inventan.** `sync-catalog` inserta `TID Sucursal {code}` con
   dirección `PENDIENTE (ERP)` y ciudad fija `Manizales`, aunque `TIDBODE` trae
   `NOMBRE` y 103 columnas. Por eso conviven las 3 reales (1, 2, 11) con 7 `SUC-00x`
   viejas inactivas.

5. **`TIDSAL.INCATE` no sirve como FK de categoría** (por eso el código deriva la
   categoría del prefijo del SKU, que sí coincide con `TIDTAB`):
   - 34.659 de 51.938 filas tienen `INCATE` vacío;
   - 287 valores distintos; solo **25** existen en `TIDTAB` y **2** en `TIDCATE`;
   - `TIDCATE` (174 filas) es un árbol aparte (Electrodomésticos), no el de alimentos.

6. **Impuestos (cerrado en F2).** Se leen en vivo de `TIDTIPOS` (`CLASE='IM'`)
   y se hace upsert a `tax_rates`; la asignación `INTIMP → tax_rate_id` ya no es
   hardcodeada. Ver `sync-catalog.mjs` (`TIPO_TO_TAX_CODE` + upsert).

7. **Sin huella para maestros.** Cada corrida recorre y reescribe todas las marcas y
   categorías; no hay `erp_snapshot` para `TIDMARCAS`, `TIDTAB`, `TIDTPRO` ni `TIDBODE`.

8. **Sin arbitraje de conflicto.** Postgres empuja cambios (outbox) y el pull puede
   pisarlos, pero solo en los campos que el pull escribe: no hay una regla explícita
   campo por campo.

### 3.1 Encoding ANSI y limpieza de marcas corruptas

`asqlcmd64.exe` es **ANSI (Windows-1252)**, no UTF-8. Antes del fix en
`asqlcmd.mjs` los nombres del ERP se decodificaban como UTF-8 y los acentuados
(`Ñ`, `É`, `Á`, `Í`, `Ó`, `Ú`, `´` = bytes `0x80-0xFF`) se corrompían a
`U+FFFD '�'`. Ese `�` se propagó en dos saltos:

1. **Pull corrupto**: `sync-masters`/`sync-catalog` crearon 62 marcas `�` en
   Postgres (soft-deleteadas en la primera limpieza).
2. **Push corrupto**: `push-catalog` volvió a escribir esas marcas `�` en
   `TIDMARCAS`; como `U+FFFD` no existe en Windows-1252, el carácter se perdió
   como **`?` (0x3F)**. Resultado: 60 marcas nuevas (`90021386`–`90021446`, con
   código `9`+id) y 2 sobrescritas (`SAVOR?S`=2001712, `PEQUE?IN`=2001545).
3. **Re-import**: el siguiente pull trajo esas `?` del ERP a Postgres (62 marcas
   activas con `?`).

**Limpieza final (sin borrar nada en Advantage):**
- Advantage: **UPDATE** de los 62 nombres `?` → nombre limpio (`SAVOR?S`→`SAVOR´S`,
  `PEQUE?IN`→`PEQUEÑIN`, `LA CORU?A`→`LA CORUÑA`…). Las 60 marcas `90021386`+
  quedan como duplicados con nombre bien escrito (el ERP ya tenía duplicados por
  nombre con distinto código).
- Postgres: **soft-delete** de las 62 marcas `?` (0 productos); las contrapartes
  limpias ya existen y conservan su `code`.

**Blindaje (para que no se repita):**
- `sync-masters` ignora nombres con `?`/`�` (no re-importa).
- `sync-masters`, al chocar nombre duplicado, **no pisa el `code` ya existente**
  (`code = COALESCE(code, $1)`): los duplicados del ERP (mismo nombre, dos
  códigos) no voltean el código canónico.
- `push-catalog` no empuja marcas con nombre `?`/`�`.

Con esto `SAVOR´S` conserva `2001711` (no salta a `2001712`) y `PEQUEÑIN`
conserva `325` (no salta a `2001545`).

---

## 4. Modelo propuesto

### Propiedad de cada dato

| Dato | Dueño | Regla |
|---|---|---|
| Nombre, EAN, precio, stock, costo, dimensiones | ERP | El pull manda; el push solo refleja ediciones locales puntuales |
| Marca, tipo, categoría, impuesto, bodega | ERP | Llave = **código** ERP, nunca el nombre |
| Imágenes, descripciones web, banners, popups, colecciones, SEO | Postgres | El ERP nunca los toca |
| `is_active` de producto/tipo/categoría | ERP **y** ajuste web | `is_active = ERP(HABILITA/INACTIVO) AND web_no_oculto` |
| Clientes, pedidos, facturas | mixto | Ya resuelto en `sync-*` |

### Reglas del pull de maestros

1. **Llave natural = código ERP** (`MCODIGO`, `TIDTAB.CTABCOD`, `TIDTPRO.CODIGO`,
   `TIDBODE.CODIGO`), guardado en `brands.code`, `categories.code`, etc.
2. **Upsert por código** con `ON CONFLICT (code)`:
   - renombre → `UPDATE name` (no crear fila nueva);
   - baja (`HABILITA='F'` / registro ausente) → `is_active=false` (no borrar, para no
     romper pedidos históricos);
   - alta → `INSERT`.
3. **Huella por tabla** (`erp_snapshot.erp_table = 'TIDMARCAS'`, etc.) para no
   reescribir todo en cada ciclo.
4. **Aislamiento de triggers** con `SET app.erp_sync='on'` (ya se hace en los pulls).
5. **Un solo script** `sync-masters.mjs` para marcas, tipos, categorías, bodegas e
   impuestos, llamado por el demonio en el mismo ciclo que `sync-catalog`.

### Fases

| Fase | Alcance | Riesgo |
|---|---|---|
| **F1** | `sync-masters.mjs`: marcas, tipos, categorías y bodegas en vivo desde la base (no `.ADT`), upsert por código + renombre + baja lógica + huella | Bajo: solo maestros |
| **F2** | ✅ Impuestos desde `TIDTIPOS` (`CLASE='IM'`) → upsert `tax_rates` + asignación `INTIMP` dinámica (sin tabla hardcodeada) | Cerrado |
| **F3** | Proveedores (`INPROVEE` + `TIDLISTA`), vendedores (`VEDVEN`) y rutas (`RUTA*`) como entidades nuevas | Medio: tablas nuevas |
| **F4** | Bajas/reconciliación completa: detectar artículos desaparecidos de `TIDSAL`, categorías y marcas huérfanas; reporte de divergencias | Alto: toca catálogo |

---

## 5. Decisiones pendientes (para cerrar antes de F1)

1. **Categoría borrada en el ERP**: ¿se desactiva en PG (propuesto) o se borra?
2. **Marca renombrada**: ¿se renombra en PG por código (propuesto) o se crea una nueva?
3. **Tipos activos**: ✅ resuelto — el ERP manda (`TIDTPRO.HABILITA`): `T`=activo,
   `' '`/`F`=inactivo. Se aplica con `--types-active=erp` en el demonio (260 activos).
4. **`TIDCATE` vs `TIDTAB`**: se confirma que el árbol del catálogo es `TIDTAB`
   (coincide con el prefijo del SKU). `TIDCATE` queda fuera salvo para
   electrodomésticos.
5. **Bodegas**: ✅ resuelto — la fuente canónica es `TIDBODE` (3 filas = `TIDSAL.INSUC`,
   con `NOMBRE` real: CENTRO, SULTANA, PALERMO). `TIDSUCUR` (~151 puntos) queda fuera.
