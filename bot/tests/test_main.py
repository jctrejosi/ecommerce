"""Pruebas de la API expuesta en `app/main.py` (httpx ASGITransport)."""
import uuid

import pytest
from fastapi.testclient import TestClient

from app import cart, config, database, deepseek, rate_limit, tools
from app.main import app
from tests.fakes import cart_with, empty_cart, make_product


# ─── Health ─────────────────────────────────────────────────────


async def test_health_con_bd_conectada(client, monkeypatch):
    async def fake_ping():
        return True

    monkeypatch.setattr(database, "ping", fake_ping)

    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "database": "connected",
        "model": config.DEEPSEEK_MODEL,
    }


async def test_health_con_bd_caida(client, monkeypatch):
    async def fake_ping():
        return False

    monkeypatch.setattr(database, "ping", fake_ping)

    body = (await client.get("/health")).json()
    assert body["status"] == "degraded"
    assert body["database"] == "disconnected"


async def test_health_si_ping_lanza_excepcion(client, monkeypatch):
    async def fake_ping():
        raise ConnectionError("sin red")

    monkeypatch.setattr(database, "ping", fake_ping)

    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "degraded"


async def test_raiz_no_existe(client):
    assert (await client.get("/")).status_code == 404


# ─── Lifespan (arranque / apagado) ──────────────────────────────


def test_lifespan_valida_bd_y_limpia_sesiones(monkeypatch):
    llamadas = {"closed": False}

    async def fake_ping():
        return True

    async def fake_cleanup():
        return (2, 3)

    async def fake_close():
        llamadas["closed"] = True

    monkeypatch.setattr(database, "ping", fake_ping)
    monkeypatch.setattr(cart, "cleanup_expired", fake_cleanup)
    monkeypatch.setattr(database, "close_pool", fake_close)

    with TestClient(app) as test_client:
        assert test_client.get("/health").status_code == 200

    assert llamadas["closed"] is True


def test_lifespan_arranca_aunque_la_bd_falle(monkeypatch):
    llamadas = {"closed": False}

    async def fake_ping():
        raise ConnectionError("bd caída")

    async def fake_close():
        llamadas["closed"] = True

    monkeypatch.setattr(database, "ping", fake_ping)
    monkeypatch.setattr(database, "close_pool", fake_close)

    with TestClient(app) as test_client:
        assert test_client.get("/health").json()["status"] == "degraded"

    assert llamadas["closed"] is True


def test_lifespan_si_la_limpieza_falla_no_impide_arrancar(monkeypatch):
    async def fake_ping():
        return True

    async def fake_cleanup():
        raise RuntimeError("no se pudo limpiar")

    async def fake_close():
        return None

    monkeypatch.setattr(database, "ping", fake_ping)
    monkeypatch.setattr(cart, "cleanup_expired", fake_cleanup)
    monkeypatch.setattr(database, "close_pool", fake_close)

    with TestClient(app) as test_client:
        assert test_client.get("/health").status_code == 200


# ─── Chat options ───────────────────────────────────────────────


async def test_chat_options(client, monkeypatch):
    opciones = [{"id": "ver_carrito", "label": "Ver", "message": "Ver"}]

    async def fake_options():
        return opciones

    monkeypatch.setattr(tools, "get_enabled_quick_options", fake_options)

    response = await client.get("/chat/options")

    assert response.status_code == 200
    assert response.json() == {"options": opciones}


# ─── Carrito ────────────────────────────────────────────────────


async def test_get_cart(client, monkeypatch):
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 2000}
    )
    capturado = {}

    async def fake_get_cart(session_id):
        capturado["session_id"] = session_id
        return estado

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    response = await client.get("/cart", params={"session_id": "s-1"})

    assert response.status_code == 200
    assert response.json() == estado
    assert capturado["session_id"] == "s-1"


async def test_get_cart_requiere_session_id(client):
    assert (await client.get("/cart")).status_code == 422


async def test_add_cart_item(client, monkeypatch):
    variant = {"variant_id": 10, "price": 2000, "product_id": 1, "name": "Arroz"}
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 2000, "quantity": 2}
    )
    capturado = {}

    async def fake_variant(product_id):
        assert product_id == 1
        return variant

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        capturado.update(kwargs)
        return estado

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)

    response = await client.post(
        "/cart/items", json={"session_id": "s-1", "product_id": 1, "quantity": 2}
    )

    assert response.status_code == 200
    assert response.json() == estado
    assert capturado == {
        "session_id": "s-1",
        "variant_id": 10,
        "quantity": 2,
        "unit_price": 2000.0,
    }


@pytest.mark.parametrize("cantidad", [0])
async def test_add_cart_item_normaliza_cantidad_minima(client, monkeypatch, cantidad):
    capturado = {}

    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 2000, "product_id": 1, "name": "Arroz"}

    async def fake_stock(variant_id, branch_id=None):
        return None

    async def fake_add_item(**kwargs):
        capturado.update(kwargs)
        return empty_cart("s-1")

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)

    response = await client.post(
        "/cart/items",
        json={"session_id": "s-1", "product_id": 1, "quantity": cantidad},
    )

    assert response.status_code == 200
    assert capturado["quantity"] == 1


async def test_add_cart_item_producto_inexistente(client, monkeypatch):
    async def fake_variant(product_id):
        return None

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)

    response = await client.post(
        "/cart/items", json={"session_id": "s-1", "product_id": 999}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Producto no encontrado"


async def test_add_cart_item_agotado(client, monkeypatch):
    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 2000, "product_id": 1, "name": "Arroz"}

    async def fake_stock(variant_id, branch_id=None):
        return 0

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(database, "get_stock", fake_stock)

    response = await client.post(
        "/cart/items", json={"session_id": "s-1", "product_id": 1}
    )

    assert response.status_code == 400
    assert "agotado" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"product_id": 1},
        {"session_id": "s-1"},
        {"session_id": "s-1", "product_id": 0},
        {"session_id": "s-1", "product_id": -3},
        {"session_id": "s-1", "product_id": 1, "quantity": -1},
        {"session_id": "", "product_id": 1},
    ],
)
async def test_add_cart_item_payload_invalido(client, payload):
    assert (await client.post("/cart/items", json=payload)).status_code == 422


async def test_set_cart_item(client, monkeypatch):
    capturado = {}

    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 2000, "product_id": 1, "name": "Arroz"}

    async def fake_set_quantity(**kwargs):
        capturado.update(kwargs)
        return empty_cart("s-1")

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(cart, "set_quantity", fake_set_quantity)

    response = await client.post(
        "/cart/items/set",
        json={"session_id": "s-1", "product_id": 1, "quantity": 0},
    )

    assert response.status_code == 200
    assert capturado == {"session_id": "s-1", "variant_id": 10, "quantity": 0}


async def test_set_cart_item_producto_inexistente(client, monkeypatch):
    async def fake_variant(product_id):
        return None

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)

    response = await client.post(
        "/cart/items/set", json={"session_id": "s-1", "product_id": 999, "quantity": 1}
    )

    assert response.status_code == 404


async def test_cart_suggest(client, monkeypatch):
    productos = [make_product()]
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 2000}
    )
    capturado = {}

    async def fake_suggest_cart(session_id, limit=6):
        capturado.update({"session_id": session_id, "limit": limit})
        return {"cart": estado, "products": productos}

    monkeypatch.setattr(cart, "suggest_cart", fake_suggest_cart)

    response = await client.post("/cart/suggest", json={"session_id": "s-1", "limite": 3})

    assert response.status_code == 200
    assert response.json() == {"cart": estado, "products": productos}
    assert capturado == {"session_id": "s-1", "limit": 3}


@pytest.mark.parametrize("limite", [0, 13, -1])
async def test_cart_suggest_limite_invalido(client, limite):
    response = await client.post(
        "/cart/suggest", json={"session_id": "s-1", "limite": limite}
    )
    assert response.status_code == 422


# ─── Catálogo ───────────────────────────────────────────────────


async def test_catalog_suggestions(client, monkeypatch):
    productos = [make_product()]
    capturado = {}

    async def fake_suggested(limit=8):
        capturado["limit"] = limit
        return productos

    monkeypatch.setattr(database, "get_suggested_products", fake_suggested)

    response = await client.get("/catalog/suggestions")

    assert response.status_code == 200
    assert response.json() == {"products": productos}
    assert capturado["limit"] == 8


async def test_catalog_search_pasa_filtros(client, monkeypatch):
    capturado = {}

    async def fake_search(**kwargs):
        capturado.update(kwargs)
        return [make_product()]

    monkeypatch.setattr(database, "search_products", fake_search)

    response = await client.get(
        "/catalog/search",
        params={"query": "arroz", "categoria": "Despensa", "marca": "Diana", "limite": 4},
    )

    assert response.status_code == 200
    assert response.json()["products"]
    assert capturado == {
        "query": "arroz",
        "category": "Despensa",
        "brand": "Diana",
        "limit": 4,
    }


async def test_catalog_search_valores_por_defecto(client, monkeypatch):
    capturado = {}

    async def fake_search(**kwargs):
        capturado.update(kwargs)
        return []

    monkeypatch.setattr(database, "search_products", fake_search)

    response = await client.get("/catalog/search")

    assert response.status_code == 200
    assert capturado == {"query": "", "category": "", "brand": "", "limit": 8}


# ─── Chat ───────────────────────────────────────────────────────


async def test_chat_sin_api_key_devuelve_503(client, monkeypatch):
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")

    response = await client.post("/chat", json={"message": "hola"})

    assert response.status_code == 503
    assert "DEEPSEEK_API_KEY" in response.json()["detail"]


async def test_chat_exitoso_genera_session_id(client, monkeypatch):
    capturado = {}

    async def fake_chat_with_tools(**kwargs):
        capturado.update(kwargs)
        return {"reply": "¡Hola! Soy Daisy", "payload": {"cart": empty_cart("x")}}

    monkeypatch.setattr(deepseek, "chat_with_tools", fake_chat_with_tools)

    response = await client.post(
        "/chat",
        json={
            "message": "hola",
            "branch_id": 3,
            "history": [
                {"role": "user", "content": "buenas"},
                {"role": "assistant", "content": "hola"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "¡Hola! Soy Daisy"
    assert body["payload"] == {"cart": empty_cart("x")}
    uuid.UUID(body["session_id"])  # es un uuid válido
    assert capturado["session_id"] == body["session_id"]
    assert capturado["user_message"] == "hola"
    assert capturado["branch_id"] == 3
    assert capturado["history"] == [
        {"role": "user", "content": "buenas"},
        {"role": "assistant", "content": "hola"},
    ]


async def test_chat_respeta_session_id_y_payload_vacio(client, monkeypatch):
    capturado = {}

    async def fake_chat_with_tools(**kwargs):
        capturado.update(kwargs)
        return {"reply": "ok"}

    monkeypatch.setattr(deepseek, "chat_with_tools", fake_chat_with_tools)

    response = await client.post(
        "/chat", json={"message": "hola", "session_id": "sesion-fija"}
    )

    assert response.status_code == 200
    assert response.json() == {"reply": "ok", "session_id": "sesion-fija", "payload": {}}
    assert capturado["session_id"] == "sesion-fija"
    assert capturado["history"] == []
    assert capturado["branch_id"] is None


async def test_chat_error_del_proveedor_devuelve_502(client, monkeypatch):
    async def fake_chat_with_tools(**kwargs):
        raise RuntimeError("upstream caído")

    monkeypatch.setattr(deepseek, "chat_with_tools", fake_chat_with_tools)

    response = await client.post("/chat", json={"message": "hola"})

    assert response.status_code == 502
    assert "upstream caído" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"message": ""},
        {"message": "x" * 2001},
        {"message": "hola", "history": [{"role": "system", "content": "x"}]},
        {"message": "hola", "history": [{"role": "user"}]},
        {"message": "hola", "branch_id": "no-int"},
    ],
)
async def test_chat_payload_invalido(client, payload):
    assert (await client.post("/chat", json=payload)).status_code == 422


# ─── Rate limiting (a nivel de app) ─────────────────────────────


async def test_rate_limit_en_rutas_protegidas(client, monkeypatch):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)
    monkeypatch.setattr(rate_limit, "WINDOW", 60)

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    primera = await client.get("/cart", params={"session_id": "s-1"})
    segunda = await client.get("/cart", params={"session_id": "s-1"})

    assert primera.status_code == 200
    assert segunda.status_code == 429
    assert "Retry-After" in segunda.headers
    assert "Demasiadas peticiones" in segunda.json()["detail"]


async def test_rate_limit_no_afecta_health(client, monkeypatch):
    monkeypatch.setattr(rate_limit, "LIMIT", 1)

    async def fake_ping():
        return True

    monkeypatch.setattr(database, "ping", fake_ping)

    for _ in range(3):
        assert (await client.get("/health")).status_code == 200


async def test_cors_permite_origen_configurado(client, monkeypatch):
    async def fake_ping():
        return True

    monkeypatch.setattr(database, "ping", fake_ping)

    response = await client.get(
        "/health", headers={"Origin": config.CORS_ORIGINS[0]}
    )
    assert (
        response.headers.get("access-control-allow-origin") == config.CORS_ORIGINS[0]
    )
