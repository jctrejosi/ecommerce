"""Acceso a la base de datos del ecommerce (lectura de catálogo y stock).

Convenciones del schema (backend NestJS + Drizzle):
- `products`  → activos: is_active = true AND deleted_at IS NULL
- `product_variants` → la variante activa es la que se vende (precio actual)
- `product_images` + `media` → imágenes; `is_cover` es la principal
- `categories` / `brands` → vía product_categories / products.brand_id
- `inventory` → stock por (product_variant_id, branch_id)
"""
import asyncpg

from . import config

_pool: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    global _pool
    if _pool is None:
        if not config.DATABASE_URL:
            raise RuntimeError("DATABASE_URL no está definida")
        _pool = await asyncpg.create_pool(
            dsn=config.DATABASE_URL,
            ssl=config.get_ssl(),
            min_size=1,
            max_size=10,
            command_timeout=30,
        )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


async def ping() -> bool:
    pool = await get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT 1 AS ok")
        return bool(row and row["ok"] == 1)


# ─── Productos ────────────────────────────────────────────────────

_SEARCH_SQL = """
SELECT
  p.id::int            AS product_id,
  p.external_id,
  p.slug,
  p.name,
  p.plu,
  p.description,
  pv.id::int           AS variant_id,
  pv.sku,
  pv.current_price::float8        AS price,
  pv.current_compare_price::float8 AS compare_price,
  MIN(c.name)          AS category,
  MIN(b.name)          AS brand,
  MIN(m.path)          AS image,
  CASE WHEN COUNT(i.id) = 0 THEN NULL
       ELSE COALESCE(SUM(i.stock - i.reserved_stock) FILTER (WHERE i.stock - i.reserved_stock > 0), 0)::int
  END AS stock
FROM products p
JOIN product_variants pv
  ON pv.product_id = p.id AND pv.is_active = true AND pv.deleted_at IS NULL
LEFT JOIN product_categories pc ON pc.product_id = p.id
LEFT JOIN categories c
  ON c.id = pc.category_id AND c.is_active = true AND c.deleted_at IS NULL
LEFT JOIN brands b ON b.id = p.brand_id
LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_cover = true
LEFT JOIN media m ON m.id = pi.media_id
LEFT JOIN inventory i ON i.product_variant_id = pv.id {branch_filter}
WHERE p.is_active = true
  AND p.deleted_at IS NULL
  AND p.is_public = true
  AND ($1 = '' OR p.name ILIKE '%' || $1 || '%'
       OR p.description ILIKE '%' || $1 || '%'
       OR p.plu ILIKE '%' || $1 || '%'
       OR pv.barcode ILIKE '%' || $1 || '%'
       OR p.external_id ILIKE '%' || $1 || '%'
       OR p.id::text LIKE '%' || $1 || '%')
  AND ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.slug ILIKE '%' || $2 || '%')
  AND ($3 = '' OR b.name ILIKE '%' || $3 || '%' OR b.slug ILIKE '%' || $3 || '%')
GROUP BY p.id, pv.id
ORDER BY (p.name ILIKE '%' || $1 || '%') DESC, p.name ASC
LIMIT $4
"""


async def search_products(
    query: str = "",
    category: str = "",
    brand: str = "",
    limit: int = 8,
    branch_id: int | None = None,
) -> list[dict]:
    pool = await get_pool()
    branch_filter = "AND i.branch_id = $5" if branch_id else ""
    sql = _SEARCH_SQL.format(branch_filter=branch_filter)
    params: list = [query or "", category or "", brand or "", max(1, min(limit, 25))]
    if branch_id:
        params.append(branch_id)
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
    return [_product(row) for row in rows]


_PRODUCT_SQL = """
SELECT
  p.id::int            AS product_id,
  p.external_id,
  p.slug,
  p.name,
  p.plu,
  p.description,
  pv.id::int           AS variant_id,
  pv.sku,
  pv.barcode,
  pv.current_price::float8        AS price,
  pv.current_compare_price::float8 AS compare_price,
  c.name               AS category,
  b.name               AS brand,
  CASE WHEN COUNT(i.id) = 0 THEN NULL
       ELSE COALESCE(SUM(i.stock - i.reserved_stock) FILTER (WHERE i.stock - i.reserved_stock > 0), 0)::int
  END AS stock
FROM products p
JOIN product_variants pv
  ON pv.product_id = p.id AND pv.is_active = true AND pv.deleted_at IS NULL
LEFT JOIN product_categories pc ON pc.product_id = p.id
LEFT JOIN categories c
  ON c.id = pc.category_id AND c.is_active = true AND c.deleted_at IS NULL
LEFT JOIN brands b ON b.id = p.brand_id
LEFT JOIN inventory i ON i.product_variant_id = pv.id {branch_filter}
WHERE p.is_active = true AND p.deleted_at IS NULL AND p.is_public = true
  AND ($1 = 0 OR p.id = $1)
  AND ($2 = '' OR p.name ILIKE '%' || $2 || '%' OR p.plu ILIKE '%' || $2 || '%')
GROUP BY p.id, pv.id, c.name, b.name
ORDER BY p.name ASC
LIMIT 1
"""


async def get_product(
    product_id: int | None = None,
    name: str = "",
    branch_id: int | None = None,
) -> dict | None:
    """Detalle de un producto (variante activa + stock)."""
    pool = await get_pool()
    branch_filter = "AND i.branch_id = $3" if branch_id else ""
    sql = _PRODUCT_SQL.format(branch_filter=branch_filter)
    params: list = [product_id or 0, name or ""]
    if branch_id:
        params.append(branch_id)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
    if not row:
        return None
    product = _product(row)

    # Todas las imágenes ordenadas
    images = await get_product_images(product["product_id"])
    if images:
        product["images"] = images
    return product


async def get_product_images(product_id: int) -> list[str]:
    pool = await get_pool()
    sql = """
    SELECT m.path AS image
    FROM product_images pi
    JOIN media m ON m.id = pi.media_id
    WHERE pi.product_id = $1 AND m.path IS NOT NULL
    ORDER BY pi.position ASC NULLS LAST, pi.id ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, product_id)
    return [r["image"] for r in rows if r["image"]]


async def get_variant_for_product(product_id: int) -> dict | None:
    """Variante activa de un producto (para el carrito)."""
    pool = await get_pool()
    sql = """
    SELECT pv.id::int AS variant_id, pv.current_price::float8 AS price,
           p.id::int AS product_id, p.name
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    WHERE pv.product_id = $1 AND pv.is_active = true AND pv.deleted_at IS NULL
      AND p.is_active = true AND p.deleted_at IS NULL
    ORDER BY pv.id ASC
    LIMIT 1
    """
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, product_id)
    return dict(row) if row else None


async def get_stock(variant_id: int, branch_id: int | None = None) -> int | None:
    """Stock disponible (o None si no hay filas de inventario)."""
    pool = await get_pool()
    if branch_id:
        sql = """
        SELECT stock - reserved_stock AS available
        FROM inventory WHERE product_variant_id = $1 AND branch_id = $2
        """
        params = (variant_id, branch_id)
    else:
        sql = """
        SELECT CASE WHEN COUNT(*) = 0 THEN NULL
               ELSE COALESCE(SUM(stock - reserved_stock), 0)::int END AS available
        FROM inventory WHERE product_variant_id = $1
        """
        params = (variant_id,)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
    return row["available"] if row else None


async def get_suggested_products(limit: int = 8) -> list[dict]:
    """Lista sugerida: ofertas (compare_price) primero, luego alfabético."""
    pool = await get_pool()
    sql = """
    SELECT
      p.id::int            AS product_id,
      p.external_id,
      p.slug,
      p.name,
      p.plu,
      p.description,
      pv.id::int           AS variant_id,
      pv.sku,
      pv.current_price::float8        AS price,
      pv.current_compare_price::float8 AS compare_price,
      MIN(c.name)          AS category,
      MIN(b.name)          AS brand,
      MIN(m.path)          AS image,
      CASE WHEN COUNT(i.id) = 0 THEN NULL
           ELSE COALESCE(SUM(i.stock - i.reserved_stock) FILTER (WHERE i.stock - i.reserved_stock > 0), 0)::int
      END AS stock
    FROM products p
    JOIN product_variants pv
      ON pv.product_id = p.id AND pv.is_active = true AND pv.deleted_at IS NULL
    LEFT JOIN product_categories pc ON pc.product_id = p.id
    LEFT JOIN categories c
      ON c.id = pc.category_id AND c.is_active = true AND c.deleted_at IS NULL
    LEFT JOIN brands b ON b.id = p.brand_id
    LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_cover = true
    LEFT JOIN media m ON m.id = pi.media_id
    LEFT JOIN inventory i ON i.product_variant_id = pv.id
    WHERE p.is_active = true AND p.deleted_at IS NULL AND p.is_public = true
    GROUP BY p.id, pv.id
    ORDER BY (pv.current_compare_price IS NOT NULL) DESC, p.name ASC
    LIMIT $1
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, max(1, min(limit, 25)))
    return [_product(row) for row in rows]


def _product(row: asyncpg.Record) -> dict:
    """Serializa una fila de producto al payload del frontend."""
    product = {
        "product_id": row["product_id"],
        "variant_id": row["variant_id"],
        "external_id": row["external_id"],
        "slug": row["slug"],
        "name": row["name"],
        "plu": row["plu"],
        "description": (row["description"] or "")[:300],
        "price": float(row["price"] or 0),
        "compare_price": float(row["compare_price"]) if row["compare_price"] else None,
        "category": row["category"] or "",
        "brand": row["brand"] or "",
        "image": row["image"],
        "stock": int(row["stock"]) if row["stock"] is not None else None,
    }
    return product
