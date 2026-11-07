"""Pruebas unitarias de `app/database.py` con un pool asyncpg falso."""
import asyncpg
import pytest

from app import config, database
from tests.fakes import FakeConnection, FakePool


def fila_producto(**overrides):
    fila = {
        "product_id": 1,
        "external_id": "EXT-1",
        "slug": "arroz-diana",
        "name": "Arroz Diana",
        "plu": "123",
        "description": "Arroz blanco",
        "variant_id": 10,
        "sku": "SKU-1",
        "price": 2000.0,
        "compare_price": None,
        "category": "Despensa",
        "brand": "Diana",
        "image": "/img/arroz.png",
        "stock": 5,
    }
    fila.update(overrides)
    return fila


async def fake_pool(pool):
    return pool


@pytest.fixture
def pool(monkeypatch):
    fake = FakePool()
    monkeypatch.setattr(database, "get_pool", lambda: fake_pool(fake))
    return fake


# ─── Pool ───────────────────────────────────────────────────────


async def test_get_pool_sin_database_url_falla(monkeypatch):
    monkeypatch.setattr(config, "DATABASE_URL", "")
    monkeypatch.setattr(database, "_pool", None)

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        await database.get_pool()


async def test_get_pool_crea_una_sola_instancia(monkeypatch):
    creados = []

    async def fake_create_pool(**kwargs):
        creados.append(kwargs)
        return FakePool()

    monkeypatch.setattr(database, "_pool", None)
    monkeypatch.setattr(config, "DATABASE_URL", "postgresql://u:p@host:5432/db")
    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)

    primero = await database.get_pool()
    segundo = await database.get_pool()

    assert primero is segundo
    assert len(creados) == 1
    assert creados[0]["dsn"] == "postgresql://u:p@host:5432/db"
    assert creados[0]["min_size"] == 1
    assert creados[0]["max_size"] == 10


async def test_close_pool_cierra_y_limpia(monkeypatch):
    fake = FakePool()
    monkeypatch.setattr(database, "_pool", fake)

    await database.close_pool()

    assert fake.closed is True
    assert database._pool is None


async def test_close_pool_es_idempotente(monkeypatch):
    monkeypatch.setattr(database, "_pool", None)
    await database.close_pool()  # no debe lanzar
    assert database._pool is None


# ─── Ping / settings ────────────────────────────────────────────


async def test_ping_ok(pool):
    pool.conn._fetchrow = {"ok": 1}
    assert await database.ping() is True


@pytest.mark.parametrize("fila", [None, {"ok": 0}, {"ok": 2}])
async def test_ping_distinto_de_uno(pool, fila):
    pool.conn._fetchrow = fila
    assert await database.ping() is False


async def test_get_bot_functions_sin_fila_devuelve_vacio(pool):
    pool.conn._fetchrow = None
    assert await database.get_bot_functions() == {}


async def test_get_bot_functions_con_dict(pool):
    pool.conn._fetchrow = {"value": {"buscar_productos": True, "ver_carrito": False}}
    assert await database.get_bot_functions() == {
        "buscar_productos": True,
        "ver_carrito": False,
    }


async def test_get_bot_functions_con_json_en_texto(pool):
    pool.conn._fetchrow = {"value": '{"armar_carrito": false, "ver_carrito": true}'}
    assert await database.get_bot_functions() == {
        "armar_carrito": False,
        "ver_carrito": True,
    }


@pytest.mark.parametrize("value", ["[1, 2]", "null", '"texto"', 42])
async def test_get_bot_functions_con_valor_no_dict_devuelve_vacio(pool, value):
    pool.conn._fetchrow = {"value": value}
    assert await database.get_bot_functions() == {}


async def test_get_bot_functions_coacciona_valores_a_bool(pool):
    pool.conn._fetchrow = {"value": {"a": 1, "b": 0, "c": "texto", "d": None}}
    assert await database.get_bot_functions() == {
        "a": True,
        "b": False,
        "c": True,
        "d": False,
    }


# ─── Serialización de productos ─────────────────────────────────


def test_product_serializa_fila_completa():
    producto = database._product(fila_producto())

    assert producto == {
        "product_id": 1,
        "variant_id": 10,
        "external_id": "EXT-1",
        "slug": "arroz-diana",
        "name": "Arroz Diana",
        "plu": "123",
        "description": "Arroz blanco",
        "price": 2000.0,
        "compare_price": None,
        "category": "Despensa",
        "brand": "Diana",
        "image": "/img/arroz.png",
        "stock": 5,
    }


def test_product_trunca_descripcion_y_normaliza_nulos():
    producto = database._product(
        fila_producto(
            description="x" * 400,
            price=None,
            compare_price=0,
            category=None,
            brand=None,
            stock=None,
        )
    )

    assert len(producto["description"]) == 300
    assert producto["price"] == 0.0
    assert producto["compare_price"] is None
    assert producto["category"] == ""
    assert producto["brand"] == ""
    assert producto["stock"] is None


def test_product_convierte_precios_a_float():
    producto = database._product(fila_producto(price=1999, compare_price=2999, stock=3))
    assert producto["price"] == 1999.0
    assert producto["compare_price"] == 2999.0
    assert producto["stock"] == 3


# ─── Búsquedas ──────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("termino", "esperado"),
    [
        ("arroz", ["arroz"]),
        ("fríjoles", ["fríjoles", "fríjole", "fríjol"]),
        ("lentejas", ["lentejas", "lenteja", "lentej"]),
        ("mes", ["mes"]),
        ("", []),
    ],
)
def test_search_variants_tolera_plurales(termino, esperado):
    assert database._search_variants(termino) == esperado


async def test_search_products_reintenta_singular(monkeypatch):
    llamadas = []

    async def fake_search_once(query="", category="", brand="", limit=8, branch_id=None):
        llamadas.append((query, category, brand, limit, branch_id))
        return [{"name": "Frijol"}] if query == "fríjol" else []

    monkeypatch.setattr(database, "_search_once", fake_search_once)

    resultado = await database.search_products(query="fríjoles", limit=4, branch_id=2)

    assert resultado == [{"name": "Frijol"}]
    assert [c[0] for c in llamadas] == ["fríjoles", "fríjole", "fríjol"]
    assert all(c[4] == 2 for c in llamadas)


async def test_search_products_devuelve_vacio_sin_coincidencias(monkeypatch):
    async def fake_search_once(query="", category="", brand="", limit=8, branch_id=None):
        return []

    monkeypatch.setattr(database, "_search_once", fake_search_once)

    assert await database.search_products(query="zzz") == []


async def test_search_products_con_query_vacia_no_consulta(monkeypatch):
    """Comportamiento actual: `_search_variants('')` no devuelve términos, así
    que `search_products()` sin texto (p. ej. solo con categoría) no consulta
    la BD. Está cubierto a nivel de `_search_once` en las pruebas de
    integración."""
    llamadas = []

    async def fake_search_once(query="", category="", brand="", limit=8, branch_id=None):
        llamadas.append(query)
        return []

    monkeypatch.setattr(database, "_search_once", fake_search_once)

    assert await database.search_products(category="Lácteos") == []
    assert llamadas == []


async def test_search_once_acota_limite_y_agrega_filtro_sucursal(pool):
    await database._search_once("arroz", "Despensa", "Diana", limit=100, branch_id=9)

    sql, params = pool.conn.queries[0]
    assert "AND i.branch_id = $5" in sql
    assert params == ("arroz", "Despensa", "Diana", 25, 9)


async def test_search_once_sin_sucursal_no_usa_quinto_parametro(pool):
    await database._search_once("arroz", limit=0)

    sql, params = pool.conn.queries[0]
    assert "i.branch_id" not in sql
    assert params == ("arroz", "", "", 1)


async def test_search_once_serializa_filas(pool):
    pool.conn._fetch = [fila_producto()]

    resultado = await database._search_once("arroz")

    assert resultado[0]["product_id"] == 1
    assert resultado[0]["price"] == 2000.0


# ─── Producto / variante / stock ────────────────────────────────


async def test_get_product_sin_fila_devuelve_none(pool):
    pool.conn._fetchrow = None
    assert await database.get_product(product_id=1) is None


async def test_get_product_incluye_imagenes(pool):
    pool.conn._fetchrow = fila_producto()

    def fetch(query, args):
        if "product_images" in query:
            return [{"image": "/a.png"}, {"image": "/b.png"}]
        return []

    pool.conn._fetch = fetch

    producto = await database.get_product(product_id=1, branch_id=2)

    assert producto["images"] == ["/a.png", "/b.png"]
    assert "AND i.branch_id = $3" in pool.conn.find_queries("JOIN inventory")[0][0]
    assert pool.conn.find_queries("JOIN inventory")[0][1] == (1, "", 2)


async def test_get_product_sin_imagenes_no_agrega_clave(pool):
    pool.conn._fetchrow = fila_producto()
    pool.conn._fetch = []

    producto = await database.get_product(name="arroz")

    assert "images" not in producto
    assert pool.conn.find_queries("LIMIT 1")[0][1] == (0, "arroz")


async def test_get_product_images_ignora_vacias(pool):
    pool.conn._fetch = [{"image": "/a.png"}, {"image": None}, {"image": "/b.png"}]
    assert await database.get_product_images(1) == ["/a.png", "/b.png"]


async def test_get_variant_for_product(pool):
    pool.conn._fetchrow = {
        "variant_id": 10,
        "price": 2000.0,
        "product_id": 1,
        "name": "Arroz Diana",
    }

    variante = await database.get_variant_for_product(1)

    assert variante == {
        "variant_id": 10,
        "price": 2000.0,
        "product_id": 1,
        "name": "Arroz Diana",
    }


async def test_get_variant_for_product_inexistente(pool):
    pool.conn._fetchrow = None
    assert await database.get_variant_for_product(999) is None


async def test_get_stock_sin_sucursal(pool):
    pool.conn._fetchrow = {"available": 7}

    assert await database.get_stock(10) == 7
    sql, params = pool.conn.queries[0]
    assert "SUM(stock - reserved_stock)" in sql
    assert params == (10,)


async def test_get_stock_por_sucursal(pool):
    pool.conn._fetchrow = {"available": 2}

    assert await database.get_stock(10, branch_id=4) == 2
    sql, params = pool.conn.queries[0]
    assert "branch_id = $2" in sql
    assert params == (10, 4)


async def test_get_stock_sin_inventario(pool):
    pool.conn._fetchrow = None
    assert await database.get_stock(10) is None


async def test_get_suggested_products_acota_y_serializa(pool):
    pool.conn._fetch = [fila_producto()]

    productos = await database.get_suggested_products(limit=100)

    assert productos[0]["name"] == "Arroz Diana"
    assert pool.conn.queries[0][1] == (25,)
