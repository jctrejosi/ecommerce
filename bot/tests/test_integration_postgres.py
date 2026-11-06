"""Pruebas de integración con PostgreSQL real (Testcontainers).

Se saltan automáticamente si Docker no está disponible o si la imagen
`postgres:16-alpine` no está descargada localmente (no se hace pull para no
consumir red/disco). El esquema es el mínimo que necesitan las consultas de
`app/database.py` y `app/cart.py`.
"""
import subprocess

import pytest

from app import cart, config, database

IMAGE = "postgres:16-alpine"


def _docker_disponible() -> tuple[bool, str]:
    try:
        info = subprocess.run(
            ["docker", "info", "--format", "{{.ServerVersion}}"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if info.returncode != 0:
            return False, "Docker no responde (daemon apagado o sin permisos)"
        imagen = subprocess.run(
            ["docker", "image", "inspect", IMAGE],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if imagen.returncode != 0:
            return False, f"La imagen {IMAGE} no está descargada localmente"
        return True, ""
    except (OSError, subprocess.SubprocessError) as exc:  # noqa: BLE001
        return False, f"Docker no disponible: {exc}"


DOCKER_OK, DOCKER_MOTIVO = _docker_disponible()

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(not DOCKER_OK, reason=DOCKER_MOTIVO or "Docker no disponible"),
]

DDL = """
CREATE TABLE products (
    id serial PRIMARY KEY,
    external_id text,
    slug text,
    name text NOT NULL,
    plu text,
    description text,
    brand_id int,
    is_active boolean NOT NULL DEFAULT true,
    deleted_at timestamptz,
    is_public boolean NOT NULL DEFAULT true
);
CREATE TABLE product_variants (
    id serial PRIMARY KEY,
    product_id int NOT NULL REFERENCES products(id),
    sku text,
    barcode text,
    current_price numeric(12, 2),
    current_compare_price numeric(12, 2),
    is_active boolean NOT NULL DEFAULT true,
    deleted_at timestamptz
);
CREATE TABLE brands (id serial PRIMARY KEY, name text, slug text);
CREATE TABLE categories (
    id serial PRIMARY KEY,
    name text,
    slug text,
    is_active boolean NOT NULL DEFAULT true,
    deleted_at timestamptz
);
CREATE TABLE product_categories (
    product_id int NOT NULL REFERENCES products(id),
    category_id int NOT NULL REFERENCES categories(id),
    PRIMARY KEY (product_id, category_id)
);
CREATE TABLE media (id serial PRIMARY KEY, path text);
CREATE TABLE product_images (
    id serial PRIMARY KEY,
    product_id int NOT NULL REFERENCES products(id),
    media_id int REFERENCES media(id),
    is_cover boolean NOT NULL DEFAULT false,
    position int
);
CREATE TABLE inventory (
    id serial PRIMARY KEY,
    product_variant_id int NOT NULL REFERENCES product_variants(id),
    branch_id int NOT NULL,
    stock int NOT NULL DEFAULT 0,
    reserved_stock int NOT NULL DEFAULT 0
);
CREATE TABLE settings (key text PRIMARY KEY, value jsonb);
CREATE TABLE guest_sessions (
    id serial PRIMARY KEY,
    session_token text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE TABLE carts (
    id serial PRIMARY KEY,
    guest_session_id int NOT NULL REFERENCES guest_sessions(id),
    branch_id int,
    status text NOT NULL DEFAULT 'ACTIVE',
    created_at timestamptz NOT NULL DEFAULT now(),
    last_activity_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT now() + interval '1 day'
);
-- Mínimo de `orders` para reproducir la FK real `orders_guest_session_id_fkey`
-- que impide borrar sesiones invitado con pedidos.
CREATE TABLE orders (
    id serial PRIMARY KEY,
    guest_session_id int REFERENCES guest_sessions(id)
);
CREATE UNIQUE INDEX carts_un_carrito_activo
    ON carts (guest_session_id) WHERE status = 'ACTIVE';
CREATE TABLE cart_items (
    id serial PRIMARY KEY,
    cart_id int NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
    product_variant_id int NOT NULL REFERENCES product_variants(id),
    quantity int NOT NULL,
    unit_price numeric(12, 2) NOT NULL,
    subtotal numeric(12, 2) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cart_id, product_variant_id)
);
"""

SEED = """
INSERT INTO brands (id, name, slug) VALUES (1, 'Diana', 'diana'), (2, 'Alpina', 'alpina');
INSERT INTO categories (id, name, slug) VALUES (1, 'Despensa', 'despensa'), (2, 'Lácteos', 'lacteos');
INSERT INTO products (id, external_id, slug, name, plu, description, brand_id)
VALUES
  (1, 'EXT-1', 'arroz-diana', 'Arroz Diana 500g', '101', 'Arroz blanco', 1),
  (2, 'EXT-2', 'papa-criolla', 'Papa criolla', '102', 'Papa fresca', NULL),
  (3, 'EXT-3', 'leche-entera', 'Leche entera 1L', '103', 'Leche entera', 2);
INSERT INTO product_variants (id, product_id, sku, barcode, current_price, current_compare_price)
VALUES
  (10, 1, 'SKU-10', '770100', 2000.00, NULL),
  (20, 2, 'SKU-20', '770200', 1500.00, 1800.00),
  (30, 3, 'SKU-30', '770300', 3200.00, NULL);
INSERT INTO product_categories (product_id, category_id)
VALUES (1, 1), (2, 1), (3, 2);
INSERT INTO media (id, path)
VALUES (1, '/img/arroz.png'), (2, '/img/arroz-2.png'), (3, '/img/papa.png');
INSERT INTO product_images (product_id, media_id, is_cover, position)
VALUES (1, 1, true, 1), (1, 2, false, 2), (2, 3, true, 1);
INSERT INTO inventory (product_variant_id, branch_id, stock, reserved_stock)
VALUES (10, 1, 8, 0), (10, 2, 2, 0), (20, 1, 5, 0), (20, 2, 0, 0);
"""

_schema_creado = False


@pytest.fixture(scope="session")
def postgres_container():
    from testcontainers.postgres import PostgresContainer

    try:
        with PostgresContainer(
            IMAGE,
            username="bot",
            password="bot",
            dbname="bot_tests",
            driver=None,
        ) as container:
            yield container
    except Exception as exc:  # noqa: BLE001 - Docker puede fallar en runtime
        pytest.skip(f"No se pudo iniciar PostgreSQL de pruebas: {exc}")


@pytest.fixture(scope="session")
def dsn(postgres_container):
    host = postgres_container.get_container_host_ip()
    port = postgres_container.get_exposed_port(5432)
    return f"postgresql://bot:bot@{host}:{port}/bot_tests"


@pytest.fixture
async def db(monkeypatch, dsn, postgres_container):
    """Configura `app.database` contra el contenedor y deja datos sembrados."""
    global _schema_creado

    monkeypatch.setattr(config, "DATABASE_URL", dsn)
    monkeypatch.setattr(config, "DB_SSL", False)
    monkeypatch.setattr(database, "_pool", None)

    pool = await database.get_pool()
    async with pool.acquire() as conn:
        if not _schema_creado:
            await conn.execute(DDL)
            _schema_creado = True
        await conn.execute(
            "TRUNCATE orders, cart_items, carts, guest_sessions, inventory, "
            "product_images, media, product_categories, categories, brands, "
            "product_variants, products, settings RESTART IDENTITY CASCADE"
        )
        await conn.execute(SEED)

    try:
        yield pool
    finally:
        await database.close_pool()


# ─── Conexión y settings ────────────────────────────────────────


async def test_ping_y_settings(db):
    assert await database.ping() is True
    assert await database.get_bot_functions() == {}

    async with db.acquire() as conn:
        await conn.execute(
            "INSERT INTO settings (key, value) VALUES ('bot.functions', $1::jsonb)",
            '{"ver_carrito": false, "consultar_receta": true}',
        )

    assert await database.get_bot_functions() == {
        "ver_carrito": False,
        "consultar_receta": True,
    }


# ─── Catálogo ───────────────────────────────────────────────────


async def test_search_products_por_nombre(db):
    resultados = await database.search_products("arroz")

    assert len(resultados) == 1
    assert resultados[0]["product_id"] == 1
    assert resultados[0]["variant_id"] == 10
    assert resultados[0]["price"] == 2000.0
    assert resultados[0]["stock"] == 10  # suma de todas las sucursales
    assert resultados[0]["brand"] == "Diana"
    assert resultados[0]["category"] == "Despensa"


async def test_search_products_ignora_acentos_y_mayusculas(db):
    assert (await database.search_products("LECHE"))[0]["product_id"] == 3
    assert (await database.search_products("papa"))[0]["product_id"] == 2


async def test_search_products_filtra_categoria_y_marca(db):
    por_categoria = await database.search_products(query="leche", category="Lácteos")
    assert [p["product_id"] for p in por_categoria] == [3]

    por_marca = await database.search_products(query="arroz", brand="Diana")
    assert [p["product_id"] for p in por_marca] == [1]

    # `_search_once` (el motor de búsqueda) sí admite filtros sin término.
    solo_categoria = await database._search_once(category="Lácteos")
    assert [p["product_id"] for p in solo_categoria] == [3]
    solo_marca = await database._search_once(brand="Diana")
    assert [p["product_id"] for p in solo_marca] == [1]


async def test_search_products_filtra_por_sucursal(db):
    sin_stock = await database.search_products(query="papa", branch_id=2)
    assert sin_stock[0]["stock"] == 0

    con_stock = await database.search_products(query="papa", branch_id=1)
    assert con_stock[0]["stock"] == 5


async def test_search_products_sin_resultados(db):
    assert await database.search_products("zzz") == []


async def test_get_suggested_products_pone_ofertas_primero(db):
    productos = await database.get_suggested_products(limit=2)

    assert [p["product_id"] for p in productos] == [2, 1]
    assert productos[0]["compare_price"] == 1800.0


async def test_get_product_detalle_con_imagenes_y_stock(db):
    producto = await database.get_product(product_id=1)

    assert producto["product_id"] == 1
    assert producto["variant_id"] == 10
    assert producto["stock"] == 10
    assert producto["images"] == ["/img/arroz.png", "/img/arroz-2.png"]


async def test_get_product_por_nombre_y_por_sucursal(db):
    producto = await database.get_product(name="Leche")
    assert producto["product_id"] == 3

    producto = await database.get_product(product_id=2, branch_id=2)
    assert producto["stock"] == 0

    assert await database.get_product(product_id=999) is None


async def test_get_variant_y_stock(db):
    variante = await database.get_variant_for_product(1)
    assert variante["variant_id"] == 10
    assert variante["price"] == 2000.0

    assert await database.get_variant_for_product(999) is None
    assert await database.get_stock(10) == 10
    assert await database.get_stock(10, branch_id=2) == 2
    assert await database.get_stock(30) is None  # sin filas de inventario


# ─── Carrito ────────────────────────────────────────────────────


async def test_add_item_crea_sesion_y_carrito(db):
    estado = await cart.add_item("tok-1", variant_id=10, quantity=2, unit_price=2000.0)

    assert estado["session_id"] == "tok-1"
    assert estado["count"] == 2
    assert estado["total"] == 4000.0
    item = estado["items"][0]
    assert item["product_id"] == 1
    assert item["quantity"] == 2
    assert item["subtotal"] == 4000.0
    assert item["image"] == "/img/arroz.png"

    async with db.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM guest_sessions") == 1
        assert await conn.fetchval("SELECT count(*) FROM carts") == 1


async def test_add_item_incrementa_y_reutiliza_carrito(db):
    await cart.add_item("tok-1", variant_id=10, quantity=2, unit_price=2000.0)
    estado = await cart.add_item("tok-1", variant_id=10, quantity=1, unit_price=2000.0)

    assert estado["count"] == 3
    assert estado["total"] == 6000.0
    assert len(estado["items"]) == 1

    async with db.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM carts") == 1
        assert await conn.fetchval("SELECT count(*) FROM cart_items") == 1


async def test_set_quantity_usa_el_precio_real_de_la_variante(db):
    # unit_price deliberadamente erróneo: set_quantity lo corrige desde la BD
    await cart.add_item("tok-1", variant_id=20, quantity=1, unit_price=1.0)

    estado = await cart.set_quantity("tok-1", variant_id=20, quantity=3)

    assert estado["count"] == 3
    assert estado["total"] == 4500.0
    assert estado["items"][0]["price"] == 1500.0


async def test_set_quantity_cero_elimina(db):
    await cart.add_item("tok-1", variant_id=10, quantity=2, unit_price=2000.0)
    estado = await cart.set_quantity("tok-1", variant_id=10, quantity=0)

    assert estado["items"] == []
    assert estado["count"] == 0
    assert estado["total"] == 0.0


async def test_clear_cart(db):
    await cart.add_item("tok-1", variant_id=10, quantity=2, unit_price=2000.0)
    await cart.add_item("tok-1", variant_id=20, quantity=1, unit_price=1500.0)

    estado = await cart.clear_cart("tok-1")

    assert estado["items"] == []
    assert estado["total"] == 0.0
    assert await cart.get_cart("tok-1") == {
        "session_id": "tok-1",
        "items": [],
        "count": 0,
        "total": 0.0,
    }


async def test_get_cart_sesion_desconocida_crea_sesion_vacia(db):
    estado = await cart.get_cart("nueva")

    assert estado["items"] == []
    assert estado["total"] == 0.0
    async with db.acquire() as conn:
        assert await conn.fetchval("SELECT count(*) FROM guest_sessions") == 1


async def test_suggest_cart_llena_solo_si_esta_vacio(db):
    resultado = await cart.suggest_cart("tok-1", limit=2)

    assert [p["product_id"] for p in resultado["products"]] == [2, 1]
    assert resultado["cart"]["count"] == 2
    assert {i["product_id"] for i in resultado["cart"]["items"]} == {1, 2}

    # Una segunda llamada no duplica ni agrega productos por estar ya lleno.
    segundo = await cart.suggest_cart("tok-1", limit=2)
    assert segundo["cart"]["count"] == 2


async def test_cleanup_expired_borra_carritos_y_sesiones(db):
    async with db.acquire() as conn:
        sesion_vieja = await conn.fetchval(
            "INSERT INTO guest_sessions (session_token, expires_at) "
            "VALUES ('vieja', now() - interval '2 days') RETURNING id"
        )
        await conn.execute(
            "INSERT INTO carts (guest_session_id, status, expires_at) "
            "VALUES ($1, 'ACTIVE', now() - interval '1 day')",
            sesion_vieja,
        )

    carritos, sesiones = await cart.cleanup_expired()

    assert (carritos, sesiones) == (1, 1)


async def test_cleanup_expired_conserva_sesiones_con_pedidos(db):
    """Una sesión expirada con pedidos no se borra (la referencia `orders`)."""
    async with db.acquire() as conn:
        sesion_vieja = await conn.fetchval(
            "INSERT INTO guest_sessions (session_token, expires_at) "
            "VALUES ('vieja-con-pedido', now() - interval '2 days') RETURNING id"
        )
        await conn.execute(
            "INSERT INTO orders (guest_session_id) VALUES ($1)", sesion_vieja
        )

    carritos, sesiones = await cart.cleanup_expired()

    assert (carritos, sesiones) == (0, 0)
    async with db.acquire() as conn:
        assert (
            await conn.fetchval(
                "SELECT count(*) FROM guest_sessions WHERE id = $1", sesion_vieja
            )
            == 1
        )


# ─── End-to-end HTTP contra la BD real ──────────────────────────


async def test_api_carrito_end_to_end(db, client):
    agregar = await client.post(
        "/cart/items", json={"session_id": "api-1", "product_id": 1, "quantity": 2}
    )
    assert agregar.status_code == 200
    assert agregar.json()["total"] == 4000.0

    consultar = await client.get("/cart", params={"session_id": "api-1"})
    assert consultar.status_code == 200
    assert consultar.json()["count"] == 2

    fijar = await client.post(
        "/cart/items/set",
        json={"session_id": "api-1", "product_id": 1, "quantity": 0},
    )
    assert fijar.status_code == 200
    assert fijar.json()["items"] == []


async def test_api_catalogo_end_to_end(db, client):
    busqueda = await client.get("/catalog/search", params={"query": "arroz"})
    assert busqueda.status_code == 200
    assert [p["product_id"] for p in busqueda.json()["products"]] == [1]

    sugeridos = await client.get("/catalog/suggestions", params={"limite": 2})
    assert sugeridos.status_code == 200
    assert [p["product_id"] for p in sugeridos.json()["products"]] == [2, 1]
