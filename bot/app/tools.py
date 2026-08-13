"""Herramientas (function calling) que el bot puede ejecutar.

Cada handler recibe (args, ctx) y devuelve un dict JSON-serializable que
se le devuelve al modelo como resultado de la herramienta. Los handlers
pueden acumular payloads estructurados en `ctx["payload"]` para que el
web client los renderice (productos, carrito).
"""
from . import cart, database

MAX_SEARCH = 8


async def _payload(ctx: dict) -> dict:
    payload = ctx.setdefault("payload", {})
    return payload


# ─── Handlers ─────────────────────────────────────────────────────

async def armar_carrito(args: dict, ctx: dict) -> dict:
    """Arma el carrito con una lista de productos: la MEJOR coincidencia de
    cada uno, UNO por ítem, agregada directamente (sin preguntar)."""
    raw_items = args.get("productos") or []
    # Normalizar y deduplicar por término ("arroz, arroz" → una sola vez)
    vistos: set[str] = set()
    items: list[dict] = []
    for it in raw_items:
        nombre = str(it.get("nombre") or "").strip()
        if not nombre:
            continue
        clave = nombre.casefold()
        if clave in vistos:
            continue
        vistos.add(clave)
        items.append({"nombre": nombre, "cantidad": max(1, int(it.get("cantidad") or 1))})

    agregados: list[dict] = []
    no_encontrados: list[str] = []
    agotados: list[str] = []

    for it in items:
        resultados = await database.search_products(
            query=it["nombre"],
            limit=5,
            branch_id=ctx.get("branch_id"),
        )
        if not resultados:
            no_encontrados.append(it["nombre"])
            continue
        # Mejor coincidencia con stock (si no hay inventario registrado, stock es None → disponible)
        mejor = None
        for candidato in resultados:
            stock = await database.get_stock(candidato["variant_id"], ctx.get("branch_id"))
            if stock is None or stock > 0:
                mejor = candidato
                break
        if mejor is None:
            agotados.append(it["nombre"])
            continue
        await cart.add_item(
            session_id=ctx["session_id"],
            variant_id=mejor["variant_id"],
            quantity=it["cantidad"],
            unit_price=float(mejor["price"] or 0),
            branch_id=ctx.get("branch_id"),
        )
        agregados.append({**mejor, "cantidad": it["cantidad"]})

    cart_state = await cart.get_cart(ctx["session_id"])
    payload = await _payload(ctx)
    payload["cart"] = cart_state
    (await _payload(ctx)).setdefault("products", []).extend(agregados)

    partes = [f"Agregué {len(agregados)} producto(s) al carrito."]
    if agregados:
        detalle = ", ".join(f"{a['name']} x{a['cantidad']}" for a in agregados)
        partes.append(f"Carrito: {detalle} (total ${cart_state['total']:,.0f}).")
    if no_encontrados:
        partes.append(f"No encontré: {', '.join(no_encontrados)}.")
    if agotados:
        partes.append(f"Estaban agotados: {', '.join(agotados)}.")
    partes.append("Confirma el carrito con el cliente y pregunta si quiere ajustar algo.")
    return {
        "ok": True,
        "agregados": agregados,
        "no_encontrados": no_encontrados,
        "agotados": agotados,
        "carrito": cart_state,
        "mensaje": " ".join(partes),
    }


async def armar_lista_sugerida(args: dict, ctx: dict) -> dict:
    """Arma una lista sugerida de BASE: agrega productos sugeridos al carrito
    (si está vacío) y devuelve el carrito + las opciones extra."""
    result = await cart.suggest_cart(
        session_id=ctx["session_id"],
        limit=int(args.get("limite") or MAX_SEARCH),
        branch_id=ctx.get("branch_id"),
    )
    payload = await _payload(ctx)
    payload["cart"] = result["cart"]
    (await _payload(ctx)).setdefault("products", []).extend(result["products"])
    if result["cart"]["items"] and any(
        p["product_id"] in {i["product_id"] for i in result["cart"]["items"]}
        for p in result["products"]
    ):
        return {
            "ok": True,
            "carrito": result["cart"],
            "mensaje": (
                "Armé una lista sugerida de base en el carrito. "
                "Preséntala al cliente: productos, cantidades y total. "
                "Pregunta si quiere quitar o agregar algo más."
            ),
        }
    return {
        "ok": True,
        "carrito": result["cart"],
        "productos": result["products"],
        "mensaje": (
            "El carrito ya tenía productos, así que no agregué la lista sugerida. "
            "Muestra el carrito actual y ofrece los productos sugeridos como opciones."
        ),
    }


async def buscar_productos(args: dict, ctx: dict) -> dict:
    """Busca productos en el catálogo por nombre, marca o categoría."""
    limit = int(args.get("limite") or MAX_SEARCH)
    products = await database.search_products(
        query=str(args.get("query") or "").strip(),
        category=str(args.get("categoria") or "").strip(),
        brand=str(args.get("marca") or "").strip(),
        limit=limit,
        branch_id=ctx.get("branch_id"),
    )
    (await _payload(ctx)).setdefault("products", []).extend(products)
    if not products:
        return {
            "ok": False,
            "total": 0,
            "mensaje": "No encontré productos con esos criterios. Pide al cliente que intente con otro nombre o término.",
        }
    return {
        "ok": True,
        "total": len(products),
        "productos": products,
        "mensaje": "Devuelve la lista de productos encontrados con su precio.",
    }


async def ver_producto(args: dict, ctx: dict) -> dict:
    """Devuelve el detalle de un producto (variante, precio, stock, imágenes)."""
    product = await database.get_product(
        product_id=int(args.get("product_id") or 0),
        name=str(args.get("nombre") or "").strip(),
        branch_id=ctx.get("branch_id"),
    )
    if not product:
        return {
            "ok": False,
            "mensaje": "No encontré ese producto en el catálogo.",
        }
    (await _payload(ctx)).setdefault("products", []).append(product)
    return {
        "ok": True,
        "producto": product,
        "mensaje": "Devuelve el detalle del producto: nombre, precio y disponibilidad.",
    }


async def agregar_al_carrito(args: dict, ctx: dict) -> dict:
    """Agrega un producto (por product_id) al carrito de la sesión."""
    product_id = int(args.get("product_id") or 0)
    cantidad = max(1, int(args.get("cantidad") or 1))
    if product_id <= 0:
        return {"ok": False, "mensaje": "Falta el product_id del producto a agregar."}

    variant = await database.get_variant_for_product(product_id)
    if not variant:
        return {"ok": False, "mensaje": "No encontré ese producto en el catálogo."}

    stock = await database.get_stock(variant["variant_id"], ctx.get("branch_id"))
    if stock is not None and stock <= 0:
        return {"ok": False, "mensaje": "Ese producto está agotado."}
    if stock is not None and cantidad > stock:
        return {
            "ok": False,
            "mensaje": f"Solo hay {stock} unidades disponibles de {variant['name']}.",
        }

    cart_state = await cart.add_item(
        session_id=ctx["session_id"],
        variant_id=variant["variant_id"],
        quantity=cantidad,
        unit_price=float(variant["price"] or 0),
        branch_id=ctx.get("branch_id"),
    )
    payload = await _payload(ctx)
    payload["cart"] = cart_state
    item = next(
        (i for i in cart_state["items"] if i["variant_id"] == variant["variant_id"]),
        None,
    )
    return {
        "ok": True,
        "nombre": variant["name"],
        "cantidad_en_carrito": item["quantity"] if item else cantidad,
        "carrito_total": cart_state["total"],
        "mensaje": (
            f"Confirmé la adición de {variant['name']} al carrito. "
            f"El carrito ahora tiene {cart_state['count']} unidades por ${cart_state['total']:,.0f}."
        ),
    }


async def ver_carrito(args: dict, ctx: dict) -> dict:
    """Devuelve el estado actual del carrito de la sesión."""
    cart_state = await cart.get_cart(ctx["session_id"])
    payload = await _payload(ctx)
    payload["cart"] = cart_state
    if not cart_state["items"]:
        return {"ok": True, "carrito": cart_state, "mensaje": "El carrito está vacío."}
    return {
        "ok": True,
        "carrito": cart_state,
        "mensaje": "Muestra el resumen del carrito con los productos, cantidades y el total.",
    }


async def quitar_del_carrito(args: dict, ctx: dict) -> dict:
    """Quita unidades (o todo) de un producto del carrito."""
    product_id = int(args.get("product_id") or 0)
    cantidad = int(args.get("cantidad") or 0)
    if product_id <= 0:
        return {"ok": False, "mensaje": "Falta el product_id del producto a quitar."}

    variant = await database.get_variant_for_product(product_id)
    if not variant:
        return {"ok": False, "mensaje": "No encontré ese producto en el carrito."}

    cart_state = await cart.get_cart(ctx["session_id"])
    current = next(
        (i for i in cart_state["items"] if i["variant_id"] == variant["variant_id"]),
        None,
    )
    if not current:
        return {"ok": False, "mensaje": "Ese producto no está en el carrito."}

    remaining = current["quantity"] - cantidad if cantidad > 0 else 0
    cart_state = await cart.set_quantity(
        session_id=ctx["session_id"],
        variant_id=variant["variant_id"],
        quantity=max(0, remaining),
        branch_id=ctx.get("branch_id"),
    )
    payload = await _payload(ctx)
    payload["cart"] = cart_state
    return {
        "ok": True,
        "carrito": cart_state,
        "mensaje": (
            f"Actualicé el carrito: {variant['name']} ahora tiene "
            f"{remaining} unidades. Total: ${cart_state['total']:,.0f}."
        ),
    }


async def vaciar_carrito(args: dict, ctx: dict) -> dict:
    """Vacía por completo el carrito de la sesión."""
    cart_state = await cart.clear_cart(ctx["session_id"])
    payload = await _payload(ctx)
    payload["cart"] = cart_state
    return {"ok": True, "carrito": cart_state, "mensaje": "El carrito quedó vacío."}


async def finalizar_compra(args: dict, ctx: dict) -> dict:
    """Resumen final del carrito para pasar al checkout en el sitio web."""
    cart_state = await cart.get_cart(ctx["session_id"])
    payload = await _payload(ctx)
    payload["cart"] = cart_state
    if not cart_state["items"]:
        return {"ok": True, "mensaje": "El carrito está vacío; aún no hay nada que finalizar."}
    payload["checkout"] = True
    return {
        "ok": True,
        "carrito": cart_state,
        "mensaje": (
            f"Tu carrito tiene {cart_state['count']} productos por "
            f"${cart_state['total']:,.0f}. El cliente debe presionar el botón "
            "'Ir a pagar' para completar la compra en el sitio."
        ),
    }


# ─── Definiciones para DeepSeek ───────────────────────────────────

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "armar_carrito",
            "description": (
                "Arma el carrito con la lista de productos que pide el cliente: "
                "busca la MEJOR coincidencia de cada producto y agrega UNO por "
                "ítem directamente, sin preguntar cuál elegir. Úsala cuando el "
                "cliente diga que necesita/quiero/compra varios productos "
                "(ej: 'necesito arroz, fríjoles y lentejas'). Extrae cada "
                "producto y su cantidad (si la menciona) en el arreglo 'productos'."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "productos": {
                        "type": "array",
                        "description": "Los productos que pidió el cliente (uno por ítem).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "nombre": {
                                    "type": "string",
                                    "description": "Nombre o término del producto (ej: 'arroz').",
                                },
                                "cantidad": {
                                    "type": "integer",
                                    "description": "Cantidad de unidades (por defecto 1).",
                                },
                            },
                            "required": ["nombre"],
                        },
                    },
                },
                "required": ["productos"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "armar_lista_sugerida",
            "description": (
                "Arma una lista sugerida de compras de BASE: si el carrito está "
                "vacío, agrega automáticamente productos sugeridos del catálogo "
                "(ofertas primero). Úsala cuando el cliente salude por primera "
                "vez, pida recomendaciones o no sepa qué comprar."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "limite": {
                        "type": "integer",
                        "description": "Cantidad de productos sugeridos (por defecto 8).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "buscar_productos",
            "description": (
                "Busca productos del catálogo por nombre, descripción, código, "
                "marca o categoría. Úsala SIEMPRE antes de agregar algo al "
                "carrito cuando el cliente pida un producto o no conozcas su "
                "product_id exacto. Devuelve productos reales de la BD con su precio."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Texto a buscar (nombre, plu, código de barras).",
                    },
                    "categoria": {
                        "type": "string",
                        "description": "Categoría para filtrar (opcional).",
                    },
                    "marca": {
                        "type": "string",
                        "description": "Marca para filtrar (opcional).",
                    },
                    "limite": {
                        "type": "integer",
                        "description": "Máximo de resultados (por defecto 8).",
                    },
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_producto",
            "description": (
                "Devuelve el detalle de un producto: precio, stock, categoría, "
                "marca e imágenes. Úsala cuando el cliente pregunte por un "
                "producto específico o quiera detalles de uno ya encontrado."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "integer",
                        "description": "Id numérico del producto.",
                    },
                    "nombre": {
                        "type": "string",
                        "description": "Nombre del producto (alternativa al id).",
                    },
                },
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "agregar_al_carrito",
            "description": (
                "Agrega un producto al carrito de compras de la sesión del cliente. "
                "IMPORTANTE: usa un product_id real obtenido con buscar_productos o "
                "ver_producto. Confirma con el cliente la cantidad si no la indicó."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "integer",
                        "description": "Id del producto a agregar.",
                    },
                    "cantidad": {
                        "type": "integer",
                        "description": "Cantidad de unidades (por defecto 1).",
                    },
                },
                "required": ["product_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ver_carrito",
            "description": (
                "Devuelve el estado actual del carrito (productos, cantidades y total). "
                "Úsala cuando el cliente pregunte 'qué tengo en el carrito' o quiera "
                "revisar su pedido."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "quitar_del_carrito",
            "description": (
                "Quita unidades de un producto del carrito, o todo el producto "
                "si no se indica cantidad. Úsala cuando el cliente pida quitar "
                "o reducir algo."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "product_id": {
                        "type": "integer",
                        "description": "Id del producto a quitar.",
                    },
                    "cantidad": {
                        "type": "integer",
                        "description": "Unidades a quitar. Si se omite, se elimina todo.",
                    },
                },
                "required": ["product_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "vaciar_carrito",
            "description": "Vacía por completo el carrito de la sesión.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "finalizar_compra",
            "description": (
                "Prepara el resumen final del carrito para que el cliente pase al "
                "checkout en el sitio web. Úsala cuando el cliente diga que quiere "
                "pagar, finalizar, comprar o ir al checkout."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    },
]

FUNCTION_MAP = {
    "armar_carrito": armar_carrito,
    "armar_lista_sugerida": armar_lista_sugerida,
    "buscar_productos": buscar_productos,
    "ver_producto": ver_producto,
    "agregar_al_carrito": agregar_al_carrito,
    "ver_carrito": ver_carrito,
    "quitar_del_carrito": quitar_del_carrito,
    "vaciar_carrito": vaciar_carrito,
    "finalizar_compra": finalizar_compra,
}

ALL_FUNCTION_NAMES = set(FUNCTION_MAP.keys())


async def enabled_function_names() -> set[str]:
    """Nombres de las funciones habilitadas según la config `bot.functions`.

    Sin config en BD → todas habilitadas. Una función ausente en el JSON se
    considera habilitada (retrocompatible al agregar funciones nuevas).
    """
    cfg = await database.get_bot_functions()
    if not cfg:
        return set(ALL_FUNCTION_NAMES)
    return {name for name in ALL_FUNCTION_NAMES if cfg.get(name, True)}


async def get_enabled_tools() -> list[dict]:
    """Lista de herramientas (schemas) que se envían a DeepSeek, filtradas."""
    enabled = await enabled_function_names()
    return [t for t in TOOLS if t["function"]["name"] in enabled]


async def get_enabled_quick_options() -> list[dict]:
    """Opciones rápidas cuyas funciones están habilitadas."""
    enabled = await enabled_function_names()
    return [o for o in QUICK_OPTIONS if o["id"] in enabled]

# Opciones rápidas que ve el cliente al abrir el chat.
# SOLO opciones programadas: cada una corresponde a una herramienta con su
# propia function calling. (Sin opciones de chat libre.)
QUICK_OPTIONS = [
    {
        "id": "armar_carrito",
        "label": "🛒 Armar mi carrito de compras",
        "message": "Quiero armar mi carrito de compras.",
    },
    {
        "id": "armar_lista_sugerida",
        "label": "✨ Sugerirme una lista",
        "message": "Sugiéreme una lista de compras.",
    },
    {
        "id": "buscar_productos",
        "label": "🔍 Buscar un producto",
        "message": "Quiero buscar un producto.",
    },
    {
        "id": "ver_carrito",
        "label": "🧾 Ver mi carrito",
        "message": "¿Qué tengo en mi carrito?",
    },
    {
        "id": "finalizar_compra",
        "label": "🛒 Finalizar mi compra",
        "message": "Quiero finalizar mi compra.",
    },
]
