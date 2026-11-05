"""Pruebas unitarias de `app/cart.py` (conexión asyncpg falsa)."""
import pytest

from app import cart, database
from tests.fakes import FakeConnection, FakePool, cart_with, empty_cart, make_product


@pytest.fixture
def conn(monkeypatch):
    connection = FakeConnection()
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(connection)))
    return connection


async def _async(value):
    return value


# ─── Sesiones / carritos ────────────────────────────────────────


async def test_ensure_guest_session_reutiliza_la_existente(monkeypatch):
    conn = FakeConnection(fetchrow={"id": 42})
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    assert await cart.ensure_guest_session("tok-1") == 42
    assert len(conn.queries) == 1
    assert "SELECT id FROM guest_sessions" in conn.queries[0][0]
    assert conn.queries[0][1] == ("tok-1",)


async def test_ensure_guest_session_la_crea_si_no_existe(monkeypatch):
    respuestas = iter([None, {"id": 77}])

    def fetchrow(query, args):
        return next(respuestas)

    conn = FakeConnection(fetchrow=fetchrow)
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    assert await cart.ensure_guest_session("nueva") == 77
    assert "INSERT INTO guest_sessions" in conn.queries[1][0]
    assert conn.queries[1][1] == ("nueva",)


async def test_ensure_cart_devuelve_activo_y_actualiza_actividad(monkeypatch):
    conn = FakeConnection(fetchrow={"id": 5})
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    assert await cart.ensure_cart(99) == 5
    assert "SELECT id FROM carts" in conn.queries[0][0]
    assert conn.queries[0][1] == (99, cart.CART_STATUS)
    assert "UPDATE carts SET last_activity_at" in conn.queries[1][0]
    assert conn.queries[1][1] == (5,)


async def test_ensure_cart_lo_crea_si_no_hay_activo(monkeypatch):
    respuestas = iter([None, {"id": 8}])

    def fetchrow(query, args):
        return next(respuestas)

    conn = FakeConnection(fetchrow=fetchrow)
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    assert await cart.ensure_cart(99, branch_id=3) == 8
    assert "INSERT INTO carts" in conn.queries[1][0]
    assert conn.queries[1][1] == (99, 3, cart.CART_STATUS)


# ─── Ítems ──────────────────────────────────────────────────────


async def test_add_item_inserta_con_subtotal(monkeypatch, conn):
    async def fake_gs(session_id):
        return 50

    async def fake_cart(gs_id, branch_id=None):
        return 500

    async def fake_get_cart(session_id):
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 2500, "quantity": 2}
        )

    monkeypatch.setattr(cart, "ensure_guest_session", fake_gs)
    monkeypatch.setattr(cart, "ensure_cart", fake_cart)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await cart.add_item("s-1", variant_id=10, quantity=2, unit_price=2500.0)

    assert result["count"] == 2
    inserts = conn.find_queries("INSERT INTO cart_items")
    assert len(inserts) == 1
    assert inserts[0][1] == (500, 10, 2, 2500.0, 5000.0)
    assert "ON CONFLICT (cart_id, product_variant_id)" in inserts[0][0]
    assert conn.find_queries("UPDATE carts SET last_activity_at")


async def test_set_quantity_cero_elimina_el_item(monkeypatch, conn):
    async def fake_gs(session_id):
        return 50

    async def fake_cart(gs_id, branch_id=None):
        return 500

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "ensure_guest_session", fake_gs)
    monkeypatch.setattr(cart, "ensure_cart", fake_cart)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await cart.set_quantity("s-1", variant_id=10, quantity=0)

    assert result["items"] == []
    assert conn.find_queries("DELETE FROM cart_items")
    assert not conn.find_queries("INSERT INTO cart_items")


async def test_set_quantity_positiva_resuelve_precio_real(monkeypatch, conn):
    async def fake_gs(session_id):
        return 50

    async def fake_cart(gs_id, branch_id=None):
        return 500

    async def fake_get_cart(session_id):
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1800, "quantity": 3}
        )

    conn._fetchrow = lambda query, args: (
        {"price": 1800.0} if "product_variants" in query else None
    )
    monkeypatch.setattr(cart, "ensure_guest_session", fake_gs)
    monkeypatch.setattr(cart, "ensure_cart", fake_cart)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    await cart.set_quantity("s-1", variant_id=10, quantity=3)

    inserts = conn.find_queries("INSERT INTO cart_items")
    assert inserts[0][1] == (500, 10, 3, 1800.0, 5400.0)


async def test_resolve_price_sin_variante_devuelve_cero():
    conn = FakeConnection(fetchrow=None)
    assert await cart._resolve_price(conn, 1234) == 0.0


async def test_clear_cart_borra_los_items_del_carrito_activo(monkeypatch, conn):
    async def fake_gs(session_id):
        return 50

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "ensure_guest_session", fake_gs)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await cart.clear_cart("s-1")

    assert result == empty_cart("s-1")
    deletes = conn.find_queries("DELETE FROM cart_items")
    assert len(deletes) == 1
    assert deletes[0][1] == (50, cart.CART_STATUS)


# ─── Consulta / totales ─────────────────────────────────────────


async def test_get_cart_calcula_totales(monkeypatch):
    filas = [
        {
            "variant_id": 10,
            "product_id": 1,
            "name": "Arroz",
            "slug": "arroz",
            "price": 2000.0,
            "quantity": 2,
            "subtotal": 4000.0,
            "image": "/arroz.png",
        },
        {
            "variant_id": 20,
            "product_id": 2,
            "name": "Leche",
            "slug": "leche",
            "price": 3200.5,
            "quantity": 1,
            "subtotal": 3200.5,
            "image": None,
        },
    ]
    conn = FakeConnection(fetch=filas)
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    async def fake_gs(session_id):
        return 50

    monkeypatch.setattr(cart, "ensure_guest_session", fake_gs)

    estado = await cart.get_cart("s-1")

    assert estado["session_id"] == "s-1"
    assert estado["count"] == 3
    assert estado["total"] == 7200.5
    assert estado["items"][0] == {
        "variant_id": 10,
        "product_id": 1,
        "name": "Arroz",
        "slug": "arroz",
        "price": 2000.0,
        "quantity": 2,
        "subtotal": 4000.0,
        "image": "/arroz.png",
    }
    sql, params = conn.find_queries("FROM cart_items")[0]
    assert params == (50, cart.CART_STATUS)


async def test_get_cart_vacio(monkeypatch):
    conn = FakeConnection(fetch=[])
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    async def fake_gs(session_id):
        return 50

    monkeypatch.setattr(cart, "ensure_guest_session", fake_gs)

    assert await cart.get_cart("s-1") == empty_cart("s-1")


# ─── Sugerencias / limpieza ─────────────────────────────────────


async def test_suggest_cart_llena_carrito_vacio(monkeypatch):
    productos = [
        make_product(product_id=1, variant_id=10, price=2000),
        make_product(product_id=2, variant_id=20, price=1500),
    ]
    agregados = []
    estados = iter([empty_cart("s-1"), cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 2000},
        {"product_id": 2, "variant_id": 20, "name": "Papa", "price": 1500},
    )])

    async def fake_get_cart(session_id):
        return next(estados)

    async def fake_suggested(limit=8):
        return productos

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    monkeypatch.setattr(database, "get_suggested_products", fake_suggested)
    monkeypatch.setattr(cart, "add_item", fake_add_item)

    result = await cart.suggest_cart("s-1", limit=2, branch_id=4)

    assert result["products"] == productos
    assert result["cart"]["count"] == 2
    assert [a["variant_id"] for a in agregados] == [10, 20]
    assert all(a["quantity"] == 1 for a in agregados)
    assert all(a["branch_id"] == 4 for a in agregados)


async def test_suggest_cart_no_modifica_carrito_con_items(monkeypatch):
    existente = cart_with(
        {"product_id": 99, "variant_id": 990, "name": "Café", "price": 8000}
    )
    llamadas = {"add": 0}

    async def fake_get_cart(session_id):
        return existente

    async def fake_suggested(limit=8):
        return [make_product()]

    async def fake_add_item(**kwargs):
        llamadas["add"] += 1
        return existente

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    monkeypatch.setattr(database, "get_suggested_products", fake_suggested)
    monkeypatch.setattr(cart, "add_item", fake_add_item)

    result = await cart.suggest_cart("s-1")

    assert result["cart"] == existente
    assert llamadas["add"] == 0


async def test_cleanup_expired_devuelve_conteos(monkeypatch):
    conn = FakeConnection(fetchval=lambda q, args: 3 if "carts" in q else 5)
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    assert await cart.cleanup_expired() == (3, 5)
    assert len(conn.queries) == 2


async def test_cleanup_expired_con_none_devuelve_ceros(monkeypatch):
    conn = FakeConnection(fetchval=None)
    monkeypatch.setattr(database, "get_pool", lambda: _async(FakePool(conn)))

    assert await cart.cleanup_expired() == (0, 0)
