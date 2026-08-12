"""Operaciones de carrito (invitado) directamente sobre la BD.

Esquema: `guest_sessions` → `carts` (guest_session_id) → `cart_items`
(cart_id + product_variant_id). Sigue las mismas reglas que el backend:
- un carrito ACTIVO por guest_session_id (índice único parcial)
- cart_items: unit_price + subtotal = unit_price * quantity
- la sesión invitado se crea de forma perezosa con el session_id que
  genera el web client (uuid) y se reutiliza entre chats.
"""
from . import database

CART_STATUS = "ACTIVE"


async def ensure_guest_session(session_id: str) -> int:
    """Devuelve el id de la sesión invitado, creándola si hace falta."""
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT id FROM guest_sessions WHERE session_token = $1 ORDER BY id DESC LIMIT 1",
            session_id,
        )
        if row:
            return row["id"]
        inserted = await conn.fetchrow(
            "INSERT INTO guest_sessions (session_token) VALUES ($1) RETURNING id",
            session_id,
        )
        return inserted["id"]


async def ensure_cart(gs_id: int, branch_id: int | None = None) -> int:
    """Devuelve el carrito ACTIVO de la sesión, creándolo si hace falta."""
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            SELECT id FROM carts
            WHERE guest_session_id = $1 AND status = $2
            ORDER BY id DESC LIMIT 1
            """,
            gs_id,
            CART_STATUS,
        )
        if row:
            await conn.execute(
                "UPDATE carts SET last_activity_at = now() WHERE id = $1",
                row["id"],
            )
            return row["id"]
        inserted = await conn.fetchrow(
            """
            INSERT INTO carts (guest_session_id, branch_id, status)
            VALUES ($1, $2, $3)
            RETURNING id
            """,
            gs_id,
            branch_id,
            CART_STATUS,
        )
        return inserted["id"]


async def add_item(
    session_id: str,
    variant_id: int,
    quantity: int,
    unit_price: float,
    branch_id: int | None = None,
) -> dict:
    """Agrega (o incrementa) un ítem al carrito. Devuelve el carrito."""
    gs_id = await ensure_guest_session(session_id)
    cart_id = await ensure_cart(gs_id, branch_id)
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_price, subtotal)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (cart_id, product_variant_id)
            DO UPDATE SET
              quantity = cart_items.quantity + EXCLUDED.quantity,
              unit_price = EXCLUDED.unit_price,
              subtotal = (cart_items.quantity + EXCLUDED.quantity) * EXCLUDED.unit_price,
              updated_at = now()
            """,
            cart_id,
            variant_id,
            quantity,
            float(unit_price),
            float(unit_price) * quantity,
        )
        await conn.execute(
            "UPDATE carts SET last_activity_at = now() WHERE id = $1",
            cart_id,
        )
    return await get_cart(session_id)


async def set_quantity(
    session_id: str,
    variant_id: int,
    quantity: int,
    branch_id: int | None = None,
) -> dict:
    """Fija la cantidad exacta de un ítem (0/negativo → lo elimina)."""
    gs_id = await ensure_guest_session(session_id)
    cart_id = await ensure_cart(gs_id, branch_id)
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        if quantity <= 0:
            await conn.execute(
                "DELETE FROM cart_items WHERE cart_id = $1 AND product_variant_id = $2",
                cart_id,
                variant_id,
            )
        else:
            # unit_price real desde la variante (si el ítem ya existía lo actualiza)
            unit_price = await _resolve_price(conn, variant_id)
            await conn.execute(
                """
                INSERT INTO cart_items (cart_id, product_variant_id, quantity, unit_price, subtotal)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (cart_id, product_variant_id)
                DO UPDATE SET
                  quantity = EXCLUDED.quantity,
                  unit_price = EXCLUDED.unit_price,
                  subtotal = EXCLUDED.quantity * EXCLUDED.unit_price,
                  updated_at = now()
                """,
                cart_id,
                variant_id,
                quantity,
                float(unit_price),
                float(unit_price) * quantity,
            )
        await conn.execute(
            "UPDATE carts SET last_activity_at = now() WHERE id = $1",
            cart_id,
        )
    return await get_cart(session_id)


async def clear_cart(session_id: str) -> dict:
    """Elimina todos los ítems del carrito activo."""
    gs_id = await ensure_guest_session(session_id)
    pool = await database.get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """
            DELETE FROM cart_items ci USING carts c
            WHERE ci.cart_id = c.id AND c.guest_session_id = $1 AND c.status = $2
            """,
            gs_id,
            CART_STATUS,
        )
    return await get_cart(session_id)


async def suggest_cart(
    session_id: str,
    limit: int = 6,
    branch_id: int | None = None,
) -> dict:
    """Lista sugerida de BASE: si el carrito está vacío, agrega productos
    sugeridos (ofertas primero). Devuelve el carrito + los productos como
    opciones extra."""
    current = await get_cart(session_id)
    suggested = await database.get_suggested_products(limit=limit)

    if not current["items"]:
        for p in suggested:
            await add_item(
                session_id=session_id,
                variant_id=p["variant_id"],
                quantity=1,
                unit_price=float(p["price"] or 0),
                branch_id=branch_id,
            )

    return {"cart": await get_cart(session_id), "products": suggested}


async def get_cart(session_id: str) -> dict:
    """Carrito activo con ítems (producto, imagen, precios) y totales."""
    gs_id = await ensure_guest_session(session_id)
    pool = await database.get_pool()
    sql = """
    SELECT
      ci.product_variant_id::int AS variant_id,
      p.id::int                  AS product_id,
      p.name,
      p.slug,
      pv.current_price::float8   AS price,
      ci.quantity::int           AS quantity,
      ci.subtotal::float8        AS subtotal,
      m.path                     AS image
    FROM cart_items ci
    JOIN carts c ON c.id = ci.cart_id
    JOIN product_variants pv ON pv.id = ci.product_variant_id
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN product_images pi ON pi.product_id = p.id AND pi.is_cover = true
    LEFT JOIN media m ON m.id = pi.media_id
    WHERE c.guest_session_id = $1 AND c.status = $2
    ORDER BY ci.created_at ASC, ci.id ASC
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(sql, gs_id, CART_STATUS)

    items = []
    for r in rows:
        items.append(
            {
                "variant_id": r["variant_id"],
                "product_id": r["product_id"],
                "name": r["name"],
                "slug": r["slug"],
                "price": float(r["price"] or 0),
                "quantity": int(r["quantity"] or 0),
                "subtotal": float(r["subtotal"] or 0),
                "image": r["image"],
            }
        )
    total = round(sum(i["subtotal"] for i in items), 2)
    count = sum(i["quantity"] for i in items)
    return {
        "session_id": session_id,
        "items": items,
        "count": count,
        "total": total,
    }


async def _resolve_price(conn, variant_id: int) -> float:
    row = await conn.fetchrow(
        "SELECT current_price::float8 AS price FROM product_variants WHERE id = $1",
        variant_id,
    )
    return float(row["price"] or 0) if row else 0.0
