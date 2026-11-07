"""Pruebas de las herramientas de function calling (`app/tools.py`).

Todo el acceso a BD/carrito se mockea: aquí se valida la lógica de selección,
validación de argumentos y armado de payloads.
"""
import pytest

from app import cart, database, recipes, tools
from tests.fakes import cart_with, empty_cart, make_product


# ─── Helpers puros ───────────────────────────────────────────────


def test_tokens_normaliza_acentos_mayusculas_y_puntuacion():
    assert tools._tokens("Pechuga de POLLO, 1kg.") == ["pechuga", "de", "pollo", "1kg"]
    assert tools._tokens("Fríjoles ñoños") == ["frijoles", "nonos"]
    assert tools._tokens("") == []


@pytest.mark.parametrize(
    "nombre",
    [
        "Comida para perro Dogourmet",
        "Alimento Gato Whiskas",
        "Jabón Rey",
        "Pañales Babysec",
        "Shampoo Pantene",
    ],
)
def test_candidato_bloqueado_para_productos_no_comestibles(nombre):
    assert tools._candidato_bloqueado(nombre) is True


@pytest.mark.parametrize(
    "nombre",
    ["Pechuga de pollo", "Papa criolla 1un", "Aceite girasol", "", "Arroz Diana"],
)
def test_candidato_no_bloqueado_para_comestibles(nombre):
    assert tools._candidato_bloqueado(nombre) is False


@pytest.mark.parametrize(
    ("producto", "ingrediente", "score"),
    [
        ("PAPA CRIOLLA 1UN", "papa", 97),
        ("Arroz Diana", "arroz", 98),
        ("Pechuga de pollo x kg", "pechuga", 95),
        ("JAMON POLLO PIETRAN", "pollo", 0),
        ("Arroz", "lenteja", 0),
        ("", "arroz", 0),
        ("Arroz", "", 0),
    ],
)
def test_score_coincidencia(producto, ingrediente, score):
    assert tools._score_coincidencia(producto, ingrediente) == score


def test_score_ignora_acentos_y_mayusculas():
    assert tools._score_coincidencia("FRÍJOL CARGAMANTO", "frijol") > 0


def test_normalize_items_deduplica_y_normaliza_cantidades():
    items = tools._normalize_items(
        [
            {"nombre": "  Arroz ", "cantidad": 2},
            {"nombre": "arroz", "cantidad": 5},
            {"nombre": "", "cantidad": 1},
            {"nombre": "Lentejas"},
            {"nombre": "Papa", "cantidad": 0},
        ]
    )
    assert items == [
        {"nombre": "Arroz", "cantidad": 2},
        {"nombre": "Lentejas", "cantidad": 1},
        {"nombre": "Papa", "cantidad": 1},
    ]


# ─── Definición de herramientas ─────────────────────────────────


def test_tools_esquema_coherente():
    assert len(tools.TOOLS) == len({t["function"]["name"] for t in tools.TOOLS})
    for tool in tools.TOOLS:
        assert tool["type"] == "function"
        function = tool["function"]
        assert function["name"] in tools.FUNCTION_MAP
        assert function["description"].strip()
        params = function["parameters"]
        assert params["type"] == "object"
        required = set(params.get("required", []))
        assert required <= set(params.get("properties", {}))


def test_function_map_cubre_todas_las_herramientas():
    nombres_schema = {t["function"]["name"] for t in tools.TOOLS}
    assert set(tools.FUNCTION_MAP) == nombres_schema
    assert tools.ALL_FUNCTION_NAMES == nombres_schema


def test_herramientas_clave_declaradas():
    assert {
        "armar_carrito",
        "armar_lista_sugerida",
        "buscar_productos",
        "ver_producto",
        "agregar_al_carrito",
        "ver_carrito",
        "quitar_del_carrito",
        "vaciar_carrito",
        "finalizar_compra",
        "consultar_receta",
    } == tools.ALL_FUNCTION_NAMES


def test_quick_options_apuntan_a_funciones_existentes():
    assert tools.QUICK_OPTIONS
    for option in tools.QUICK_OPTIONS:
        assert option["id"] in tools.FUNCTION_MAP
        assert option["label"] and option["message"]


async def test_enabled_function_names_todas_si_no_hay_config(monkeypatch):
    async def fake_get_bot_functions():
        return {}

    monkeypatch.setattr(database, "get_bot_functions", fake_get_bot_functions)
    assert await tools.enabled_function_names() == tools.ALL_FUNCTION_NAMES


async def test_enabled_function_names_filtra_deshabilitadas(monkeypatch):
    async def fake_get_bot_functions():
        return {"buscar_productos": False, "ver_carrito": False}

    monkeypatch.setattr(database, "get_bot_functions", fake_get_bot_functions)
    enabled = await tools.enabled_function_names()
    assert "buscar_productos" not in enabled
    assert "ver_carrito" not in enabled
    # Una función ausente en la config se considera habilitada.
    assert "consultar_receta" in enabled


async def test_get_enabled_tools_filtra_schemas(monkeypatch):
    async def fake_get_bot_functions():
        return {"buscar_productos": False}

    monkeypatch.setattr(database, "get_bot_functions", fake_get_bot_functions)
    enabled = await tools.get_enabled_tools()
    nombres = {t["function"]["name"] for t in enabled}
    assert "buscar_productos" not in nombres
    assert len(enabled) == len(tools.TOOLS) - 1


async def test_get_enabled_quick_options_filtra(monkeypatch):
    async def fake_get_bot_functions():
        return {"armar_carrito": False, "ver_carrito": False}

    monkeypatch.setattr(database, "get_bot_functions", fake_get_bot_functions)
    options = await tools.get_enabled_quick_options()
    ids = {o["id"] for o in options}
    assert "armar_carrito" not in ids
    assert "ver_carrito" not in ids
    assert "consultar_receta" in ids


# ─── buscar_productos / ver_producto ────────────────────────────


async def test_buscar_productos_devuelve_resultados_y_payload(monkeypatch):
    producto = make_product()
    capturado = {}

    async def fake_search(**kwargs):
        capturado.update(kwargs)
        return [producto]

    monkeypatch.setattr(database, "search_products", fake_search)
    ctx = {"session_id": "s-1", "branch_id": 3}

    result = await tools.buscar_productos(
        {"query": "arroz", "categoria": "Despensa", "marca": "Diana", "limite": 4}, ctx
    )

    assert result["ok"] is True
    assert result["total"] == 1
    assert result["productos"] == [producto]
    assert ctx["payload"]["products"] == [producto]
    assert capturado == {
        "query": "arroz",
        "category": "Despensa",
        "brand": "Diana",
        "limit": 4,
        "branch_id": 3,
    }


async def test_buscar_productos_sin_resultados(monkeypatch):
    async def fake_search(**kwargs):
        return []

    monkeypatch.setattr(database, "search_products", fake_search)
    ctx = {"session_id": "s-1"}

    result = await tools.buscar_productos({"query": "zzz"}, ctx)

    assert result["ok"] is False
    assert result["total"] == 0
    assert "No encontré" in result["mensaje"]
    assert ctx["payload"]["products"] == []


async def test_ver_producto_encontrado_y_no_encontrado(monkeypatch):
    producto = make_product(product_id=7, variant_id=70)
    capturado = {}

    async def fake_get_product(**kwargs):
        capturado.update(kwargs)
        return producto

    monkeypatch.setattr(database, "get_product", fake_get_product)
    ctx = {"session_id": "s-1", "branch_id": 2}
    result = await tools.ver_producto({"product_id": 7}, ctx)

    assert result["ok"] is True
    assert result["producto"] == producto
    assert ctx["payload"]["products"] == [producto]
    assert capturado == {"product_id": 7, "name": "", "branch_id": 2}

    async def fake_none(**kwargs):
        return None

    monkeypatch.setattr(database, "get_product", fake_none)
    result = await tools.ver_producto({"nombre": "inexistente"}, {"session_id": "s-1"})
    assert result["ok"] is False


# ─── agregar_al_carrito ─────────────────────────────────────────


async def test_agregar_al_carrito_sin_product_id():
    result = await tools.agregar_al_carrito({}, {"session_id": "s-1"})
    assert result["ok"] is False
    assert "product_id" in result["mensaje"]


async def test_agregar_al_carrito_producto_inexistente(monkeypatch):
    async def fake_variant(product_id):
        return None

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    result = await tools.agregar_al_carrito({"product_id": 99}, {"session_id": "s-1"})
    assert result["ok"] is False


async def test_agregar_al_carrito_agotado(monkeypatch):
    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 1000, "product_id": product_id, "name": "Arroz"}

    async def fake_stock(variant_id, branch_id=None):
        return 0

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(database, "get_stock", fake_stock)

    result = await tools.agregar_al_carrito({"product_id": 1}, {"session_id": "s-1"})
    assert result["ok"] is False
    assert "agotado" in result["mensaje"]


async def test_agregar_al_carrito_excede_stock(monkeypatch):
    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 1000, "product_id": product_id, "name": "Arroz"}

    async def fake_stock(variant_id, branch_id=None):
        return 2

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(database, "get_stock", fake_stock)

    result = await tools.agregar_al_carrito(
        {"product_id": 1, "cantidad": 5}, {"session_id": "s-1"}
    )
    assert result["ok"] is False
    assert "Solo hay 2" in result["mensaje"]


async def test_agregar_al_carrito_exitoso(monkeypatch):
    llamadas = {}

    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 1500, "product_id": product_id, "name": "Arroz"}

    async def fake_stock(variant_id, branch_id=None):
        return 8

    async def fake_add_item(**kwargs):
        llamadas.update(kwargs)
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1500, "quantity": 2}
        )

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    ctx = {"session_id": "s-1", "branch_id": 4}

    result = await tools.agregar_al_carrito({"product_id": 1, "cantidad": 2}, ctx)

    assert result["ok"] is True
    assert result["cantidad_en_carrito"] == 2
    assert result["carrito_total"] == 3000.0
    assert ctx["payload"]["cart"]["count"] == 2
    assert llamadas == {
        "session_id": "s-1",
        "variant_id": 10,
        "quantity": 2,
        "unit_price": 1500.0,
        "branch_id": 4,
    }


# ─── ver / quitar / vaciar / finalizar ──────────────────────────


async def test_ver_carrito_vacio(monkeypatch):
    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    ctx = {"session_id": "s-1"}

    result = await tools.ver_carrito({}, ctx)

    assert result["ok"] is True
    assert result["mensaje"] == "El carrito está vacío."
    assert ctx["payload"]["cart"] == empty_cart("s-1")


async def test_ver_carrito_con_items(monkeypatch):
    estado = cart_with({"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1000})

    async def fake_get_cart(session_id):
        return estado

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    result = await tools.ver_carrito({}, {"session_id": "s-1"})

    assert result["ok"] is True
    assert result["carrito"] == estado
    assert "resumen del carrito" in result["mensaje"]


async def test_quitar_del_carrito_sin_product_id():
    result = await tools.quitar_del_carrito({}, {"session_id": "s-1"})
    assert result["ok"] is False


async def test_quitar_del_carrito_producto_inexistente(monkeypatch):
    async def fake_variant(product_id):
        return None

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    result = await tools.quitar_del_carrito({"product_id": 5}, {"session_id": "s-1"})
    assert result["ok"] is False


async def test_quitar_del_carrito_no_esta_en_carrito(monkeypatch):
    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 1000, "product_id": product_id, "name": "Arroz"}

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.quitar_del_carrito({"product_id": 1}, {"session_id": "s-1"})
    assert result["ok"] is False
    assert "no está en el carrito" in result["mensaje"]


async def test_quitar_del_carrito_reduce_cantidad(monkeypatch):
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1000, "quantity": 3}
    )
    capturado = {}

    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 1000, "product_id": product_id, "name": "Arroz"}

    async def fake_get_cart(session_id):
        return estado

    async def fake_set_quantity(**kwargs):
        capturado.update(kwargs)
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1000, "quantity": 2}
        )

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    monkeypatch.setattr(cart, "set_quantity", fake_set_quantity)

    result = await tools.quitar_del_carrito(
        {"product_id": 1, "cantidad": 1}, {"session_id": "s-1", "branch_id": 2}
    )

    assert result["ok"] is True
    assert capturado == {
        "session_id": "s-1",
        "variant_id": 10,
        "quantity": 2,
        "branch_id": 2,
    }


async def test_quitar_del_carrito_sin_cantidad_elimina(monkeypatch):
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1000, "quantity": 3}
    )
    capturado = {}

    async def fake_variant(product_id):
        return {"variant_id": 10, "price": 1000, "product_id": product_id, "name": "Arroz"}

    async def fake_get_cart(session_id):
        return estado

    async def fake_set_quantity(**kwargs):
        capturado.update(kwargs)
        return empty_cart(kwargs["session_id"])

    monkeypatch.setattr(database, "get_variant_for_product", fake_variant)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    monkeypatch.setattr(cart, "set_quantity", fake_set_quantity)

    await tools.quitar_del_carrito({"product_id": 1}, {"session_id": "s-1"})
    assert capturado["quantity"] == 0


async def test_vaciar_carrito(monkeypatch):
    async def fake_clear(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "clear_cart", fake_clear)
    ctx = {"session_id": "s-1"}

    result = await tools.vaciar_carrito({}, ctx)
    assert result["ok"] is True
    assert result["mensaje"] == "El carrito quedó vacío."
    assert ctx["payload"]["cart"] == empty_cart("s-1")


async def test_finalizar_compra_carrito_vacio(monkeypatch):
    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    ctx = {"session_id": "s-1"}

    result = await tools.finalizar_compra({}, ctx)
    assert result["ok"] is True
    assert "vacío" in result["mensaje"]
    assert "checkout" not in ctx["payload"]


async def test_finalizar_compra_marca_checkout(monkeypatch):
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz", "price": 1000, "quantity": 2}
    )

    async def fake_get_cart(session_id):
        return estado

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    ctx = {"session_id": "s-1"}

    result = await tools.finalizar_compra({}, ctx)
    assert result["ok"] is True
    assert ctx["payload"]["checkout"] is True
    assert "Ir a pagar" in result["mensaje"]


# ─── armar_carrito ──────────────────────────────────────────────


async def test_armar_carrito_agrega_mejores_coincidencias(monkeypatch):
    arroz = make_product(product_id=1, variant_id=10, name="Arroz Diana", price=2000, stock=5)
    lentejas = make_product(product_id=2, variant_id=20, name="Lentejas", price=3000, stock=0)
    agregados = []

    async def fake_search(query, **kwargs):
        return {
            "arroz": [arroz],
            "lentejas": [lentejas],
            "pizza": [],
        }.get(query, [])

    async def fake_stock(variant_id, branch_id=None):
        return {10: 5, 20: 0}[variant_id]

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz Diana", "price": 2000, "quantity": 2}
        )

    async def fake_get_cart(session_id):
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz Diana", "price": 2000, "quantity": 2}
        )

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    ctx = {"session_id": "s-1"}

    result = await tools.armar_carrito(
        {
            "productos": [
                {"nombre": "arroz", "cantidad": 2},
                {"nombre": "lentejas"},
                {"nombre": "pizza"},
                {"nombre": "arroz", "cantidad": 9},
            ]
        },
        ctx,
    )

    assert result["ok"] is True
    assert [a["name"] for a in result["agregados"]] == ["Arroz Diana"]
    assert result["no_encontrados"] == ["pizza"]
    assert result["agotados"] == ["lentejas"]
    assert len(agregados) == 1
    assert agregados[0]["quantity"] == 2
    assert ctx["payload"]["cart"]["count"] == 2
    assert ctx["payload"]["products"] == result["agregados"]


async def test_armar_carrito_elige_candidato_con_stock(monkeypatch):
    sin_stock = make_product(product_id=1, variant_id=10, name="Arroz Diana", price=2000)
    con_stock = make_product(product_id=2, variant_id=20, name="Arroz Supremo", price=2100)
    agregados = []

    async def fake_search(query, **kwargs):
        return [sin_stock, con_stock]

    async def fake_stock(variant_id, branch_id=None):
        return 0 if variant_id == 10 else 4

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.armar_carrito({"productos": [{"nombre": "arroz"}]}, {"session_id": "s-1"})

    assert [a["variant_id"] for a in result["agregados"]] == [20]
    assert agregados[0]["unit_price"] == 2100.0


async def test_armar_carrito_sin_productos(monkeypatch):
    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.armar_carrito({}, {"session_id": "s-1"})

    assert result["ok"] is True
    assert result["agregados"] == []
    assert "Agregué 0 producto(s)" in result["mensaje"]


# ─── armar_lista_sugerida ───────────────────────────────────────


async def test_armar_lista_sugerida_arma_carrito(monkeypatch):
    productos = [
        make_product(product_id=1, variant_id=10, name="Arroz Diana", price=2000),
        make_product(product_id=2, variant_id=20, name="Papa criolla", price=1500),
    ]
    estado = cart_with(
        {"product_id": 1, "variant_id": 10, "name": "Arroz Diana", "price": 2000},
        {"product_id": 2, "variant_id": 20, "name": "Papa criolla", "price": 1500},
    )

    async def fake_suggest_cart(session_id, limit=6, branch_id=None):
        return {"cart": estado, "products": productos}

    monkeypatch.setattr(cart, "suggest_cart", fake_suggest_cart)
    ctx = {"session_id": "s-1", "branch_id": 2}

    result = await tools.armar_lista_sugerida({"limite": 2}, ctx)

    assert result["ok"] is True
    assert "lista sugerida de base" in result["mensaje"]
    assert ctx["payload"]["cart"] == estado
    assert ctx["payload"]["products"] == productos


async def test_armar_lista_sugerida_no_reemplaza_carrito_existente(monkeypatch):
    existente = cart_with(
        {"product_id": 99, "variant_id": 990, "name": "Café", "price": 8000}
    )
    productos = [make_product(product_id=1, variant_id=10, name="Arroz Diana")]

    async def fake_suggest_cart(session_id, limit=6, branch_id=None):
        return {"cart": existente, "products": productos}

    monkeypatch.setattr(cart, "suggest_cart", fake_suggest_cart)
    ctx = {"session_id": "s-1"}

    result = await tools.armar_lista_sugerida({}, ctx)

    assert result["ok"] is True
    assert "ya tenía productos" in result["mensaje"]
    assert result["productos"] == productos


# ─── consultar_receta ───────────────────────────────────────────


async def test_consultar_receta_sin_ingredientes():
    result = await tools.consultar_receta(
        {"nombre_receta": "inventada"}, {"session_id": "s-1"}
    )
    assert result["ok"] is False
    assert "No recibí ingredientes" in result["mensaje"]


async def test_consultar_receta_curada_usa_ingredientes_canonicos(monkeypatch):
    catalogo = {
        "frijol": [make_product(product_id=1, variant_id=10, name="Frijol Cargamanto", price=5000)],
        "cebolla": [make_product(product_id=2, variant_id=20, name="Cebolla cabezona", price=1000)],
        "ajo": [make_product(product_id=3, variant_id=30, name="Ajo malla", price=1200)],
        "zanahoria": [make_product(product_id=4, variant_id=40, name="Zanahoria", price=900)],
        "sal": [make_product(product_id=5, variant_id=50, name="Sal refinada", price=800)],
        "aceite": [make_product(product_id=6, variant_id=60, name="Aceite girasol", price=7000)],
    }
    agregados = []
    get_cart_calls = {"n": 0}

    async def fake_search(query, **kwargs):
        return catalogo.get(query, [])

    async def fake_stock(variant_id, branch_id=None):
        return 10

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        get_cart_calls["n"] += 1
        if get_cart_calls["n"] == 1:
            return empty_cart(session_id)
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Frijol Cargamanto", "price": 5000}
        )

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)
    ctx = {"session_id": "s-1"}

    result = await tools.consultar_receta(
        {
            "nombre_receta": "frijoles",
            # Ingredientes inventados: para recetas curadas se ignoran.
            "ingredientes": [{"nombre": "chocolate", "cantidad": 3}],
            "pasos": ["Paso inventado"],
        },
        ctx,
    )

    receta = recipes.find_recipe("frijoles")
    assert result["ok"] is True
    assert result["origen"] == "curada"
    assert len(result["ingredientes_revisados"]) == len(receta["ingredientes"])
    assert {a["name"] for a in result["agregados"]} == {
        p[0]["name"] for p in catalogo.values()
    }
    assert result["pasos"] == receta["pasos"]
    assert ctx["payload"]["receta"]["origen"] == "curada"
    assert ctx["payload"]["cart"]["count"] == 1
    assert "Pasos de preparación" in result["mensaje"]


async def test_consultar_receta_del_modelo_agrega_confiables(monkeypatch):
    producto = make_product(product_id=1, variant_id=10, name="Arroz Diana", price=2000)
    agregados = []
    get_cart_calls = {"n": 0}

    async def fake_search(query, **kwargs):
        return [producto] if query == "arroz" else []

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        get_cart_calls["n"] += 1
        if get_cart_calls["n"] == 1:
            return empty_cart(session_id)
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz Diana", "price": 2000}
        )

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "arroz simple",
            "ingredientes": [{"nombre": "arroz", "cantidad": 2}],
            "pasos": ["Cocinar el arroz."],
        },
        {"session_id": "s-1"},
    )

    assert result["ok"] is True
    assert result["origen"] == "modelo"
    assert result["agregados"][0]["variant_id"] == 10
    assert agregados[0]["quantity"] == 2
    assert result["pasos"] == ["Cocinar el arroz."]


async def test_consultar_receta_sin_agregar_no_toca_carrito(monkeypatch):
    producto = make_product(name="Arroz Diana")
    llamadas = {"add": 0}

    async def fake_search(query, **kwargs):
        return [producto]

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        llamadas["add"] += 1
        return empty_cart("s-1")

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "arroz simple",
            "ingredientes": [{"nombre": "arroz"}],
            "pasos": ["Cocinar."],
            "agregar": False,
        },
        {"session_id": "s-1"},
    )

    assert result["ok"] is True
    assert llamadas["add"] == 0
    assert result["carrito"] is None


async def test_consultar_receta_reporta_ingredientes_no_encontrados(monkeypatch):
    async def fake_search(query, **kwargs):
        return []

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "inventada",
            "ingredientes": [{"nombre": "wasabi"}],
            "pasos": ["Cocinar."],
        },
        {"session_id": "s-1"},
    )

    assert result["no_encontrados"] == ["wasabi"]
    assert result["ingredientes_revisados"][0]["estado"] == "no_encontrado"
    assert result["agregados"] == []
    assert "No encontré en el catálogo" in result["mensaje"]


async def test_consultar_receta_marca_dudosos_y_no_agrega(monkeypatch):
    """'pollo' solo coincide con 'JAMON POLLO': no es confiable."""
    jamon = make_product(product_id=1, variant_id=10, name="Jamon pollo Pietran", price=9000)
    agregados = []

    async def fake_search(query, **kwargs):
        return [jamon]

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "inventada",
            "ingredientes": [{"nombre": "pollo"}],
            "pasos": ["Cocinar."],
        },
        {"session_id": "s-1"},
    )

    assert result["dudosos"] == ["pollo"]
    assert result["agregados"] == []
    assert agregados == []
    assert result["ingredientes_revisados"][0]["estado"] == "dudoso"
    assert "DUDOSAS" in result["mensaje"]


async def test_consultar_receta_marca_agotados(monkeypatch):
    producto = make_product(name="Arroz Diana", stock=0)

    async def fake_search(query, **kwargs):
        return [producto]

    async def fake_stock(variant_id, branch_id=None):
        return 0

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "inventada",
            "ingredientes": [{"nombre": "arroz"}],
            "pasos": ["Cocinar."],
        },
        {"session_id": "s-1"},
    )

    assert result["agotados"] == ["arroz"]
    assert result["agregados"] == []
    assert result["ingredientes_revisados"][0]["estado"] == "agotado"


async def test_consultar_receta_ignora_productos_bloqueados(monkeypatch):
    whiskas = make_product(product_id=1, variant_id=10, name="Alimento gato Whiskas", price=9000)
    agregados = []

    async def fake_search(query, **kwargs):
        return [whiskas]

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "inventada",
            "ingredientes": [{"nombre": "alimento"}],
            "pasos": ["Cocinar."],
        },
        {"session_id": "s-1"},
    )

    assert result["dudosos"] == ["alimento"]
    assert agregados == []


async def test_consultar_receta_reintenta_con_primer_token(monkeypatch):
    busquedas = []
    pollo = make_product(product_id=1, variant_id=10, name="Pechuga de pollo x kg", price=12000)

    async def fake_search(query, **kwargs):
        busquedas.append(query)
        return [pollo] if query == "pechuga" else []

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        return empty_cart(session_id)

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "inventada",
            "ingredientes": [{"nombre": "pechuga de pollo"}],
            "pasos": ["Cocinar."],
        },
        {"session_id": "s-1"},
    )

    assert busquedas == ["pechuga de pollo", "pechuga"]
    assert result["agregados"][0]["product_id"] == 1


async def test_consultar_receta_no_duplica_lo_que_ya_esta_en_carrito(monkeypatch):
    producto = make_product(product_id=1, variant_id=10, name="Arroz Diana", price=2000)
    agregados = []

    async def fake_search(query, **kwargs):
        return [producto]

    async def fake_stock(variant_id, branch_id=None):
        return 5

    async def fake_add_item(**kwargs):
        agregados.append(kwargs)
        return empty_cart("s-1")

    async def fake_get_cart(session_id):
        return cart_with(
            {"product_id": 1, "variant_id": 10, "name": "Arroz Diana", "price": 2000}
        )

    monkeypatch.setattr(database, "search_products", fake_search)
    monkeypatch.setattr(database, "get_stock", fake_stock)
    monkeypatch.setattr(cart, "add_item", fake_add_item)
    monkeypatch.setattr(cart, "get_cart", fake_get_cart)

    result = await tools.consultar_receta(
        {
            "nombre_receta": "inventada",
            "ingredientes": [{"nombre": "arroz"}],
            "pasos": ["Cocinar."],
        },
        {"session_id": "s-1"},
    )

    assert agregados == []
    assert result["ya_en_carrito"] == ["Arroz Diana"]
    assert "Ya estaban en el carrito" in result["mensaje"]
