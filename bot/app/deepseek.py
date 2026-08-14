"""Cliente DeepSeek con loop de function calling.

Patrón equivalente al bot de referencia (whatsapp-bot): el modelo solo
puede ejecutar las herramientas declaradas en `tools.TOOLS`; cada ronda
ejecuta las funciones solicitadas, devuelve los resultados como mensajes
`tool` y repite hasta que el modelo responde sin tool_calls.
"""
import json
import logging

import httpx

from . import config, tools

log = logging.getLogger("bot.deepseek")

SYSTEM_PROMPT = """Eres "Daisy", la asistente de compras del supermercado en línea MercAldas.

TU ÚNICA FUNCIÓN: ayudar al cliente a ARMAR SU CARRITO DE COMPRAS con los productos que te indique, y responder consultas básicas del catálogo (precios, disponibilidad, categorías, marcas).

REGLAS DE ORO:
1. SOLO puedes hacer acciones a través de las funciones disponibles ({FUNCIONES}). NUNCA inventes que realizaste una acción que no ejecutaste.
2. NUNCA inventes productos, precios, descuentos ni disponibilidad. Todo lo que muestres debe venir de los resultados de las funciones (datos reales de la base de datos).
3. El campo "stock" de un producto puede venir como null: significa que no hay inventario registrado y el producto se considera disponible. NO lo trates como agotado. Solo di que un producto está agotado si la función agregar_al_carrito lo indica explícitamente.
4. Si el cliente te da un id numérico de producto (product_id), NO lo busques por texto: usa ver_producto o agregar_al_carrito directamente con ese product_id.
5. Cuando el cliente diga que necesita/quiero una LISTA de productos (ej: "necesito arroz, fríjoles y lentejas"), usa armar_carrito con TODOS los productos de la lista en una sola llamada. Elige la mejor coincidencia de cada uno y agrega UNO por producto. NO preguntes cuál elegir ni muestres opciones: arma el carrito y preséntalo.
6. Cuando el cliente salude por primera vez, diga "hola" sin pedir algo concreto, o pida recomendaciones/sugerencias, usa armar_lista_sugerida para dejar armada una lista sugerida de base en el carrito y preséntala.
7. Para agregar UN solo producto puntual que el cliente ya describió o señaló, usa buscar_productos (o ver_producto si ya tienes el id) y luego agregar_al_carrito con el product_id real. Confirma la cantidad con el cliente si hay duda.
8. Después de agregar o quitar productos, muestra el estado del carrito (ver_carrito) y pregunta si quiere agregar algo más.
9. Cuando el cliente pida pagar/finalizar, usa finalizar_compra y dile que presione el botón "Ir a pagar" que aparece en el chat para completar la compra en el sitio.

ESTILO:
- Preséntate siempre como "Daisy" cuando saludes (ej: "¡Hola! Soy Daisy, tu asistente de compras 😊").
- Responde SIEMPRE en español, cálido y cercano, con emojis ocasionales.
- Sé breve: máximo 3-4 oraciones por mensaje, salvo cuando muestres productos.
- Al listar productos, menciona nombre y precio de cada uno (máx. 5-6) y pregunta cuál quiere agregar.
- Si el cliente pide algo que NO está en tu alcance (domicilios, métodos de pago, garantías, quejas), responde con lo que sí sabes y ofrécele contactar a un asesor o revisar el sitio web.
- Nunca menciones "función", "tool", "base de datos" ni términos técnicos."""


async def _call_chat(
    messages: list[dict],
    use_tools: bool = True,
    tools_list: list[dict] | None = None,
) -> dict:
    """Una llamada a la API de DeepSeek. Devuelve el JSON de la respuesta."""
    if not config.DEEPSEEK_API_KEY:
        raise RuntimeError("DEEPSEEK_API_KEY no está configurada")

    body: dict = {
        "model": config.DEEPSEEK_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "max_tokens": config.MAX_TOKENS,
    }
    if use_tools:
        body["tools"] = tools_list if tools_list is not None else tools.TOOLS

    async with httpx.AsyncClient(
        headers={
            "Authorization": f"Bearer {config.DEEPSEEK_API_KEY}",
            "Content-Type": "application/json",
        },
        timeout=config.DEEPSEEK_TIMEOUT,
    ) as client:
        resp = await client.post(
            f"{config.DEEPSEEK_API_URL}/chat/completions",
            json=body,
        )
        resp.raise_for_status()
        return resp.json()


async def chat_with_tools(
    session_id: str,
    user_message: str,
    history: list[dict] | None = None,
    branch_id: int | None = None,
) -> dict:
    """Procesa un mensaje del usuario con el loop de function calling.

    Devuelve `{"reply": str, "payload": {...}}` donde payload puede contener
    `products`, `cart` y/o `checkout` para que el web client los renderice.
    """
    ctx: dict = {"session_id": session_id, "branch_id": branch_id, "payload": {}}

    # Funciones habilitadas según la config del admin (panel de bot).
    enabled_names = await tools.enabled_function_names()
    enabled_tools = await tools.get_enabled_tools()
    funciones_str = ", ".join(sorted(enabled_names))
    system_prompt = SYSTEM_PROMPT.replace("{FUNCIONES}", funciones_str)

    messages: list[dict] = [{"role": "system", "content": system_prompt}]

    # Historial acotado (últimos N turnos, alternando user/assistant)
    if history:
        for h in history[-config.MAX_HISTORY:]:
            role = h.get("role")
            content = h.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_message})

    for _round in range(config.MAX_TOOL_ROUNDS):
        data = await _call_chat(messages, use_tools=True, tools_list=enabled_tools)
        msg = data["choices"][0]["message"]
        finish = data["choices"][0].get("finish_reason")

        tool_calls = msg.get("tool_calls") or []
        if not tool_calls:
            reply = (msg.get("content") or "").strip()
            if not reply:
                reply = "¿En qué más puedo ayudarte con tu carrito? 😊"
            return {"reply": reply, "payload": ctx.get("payload") or {}}

        # Ejecutar herramientas y devolver resultados al modelo
        messages.append(
            {
                "role": "assistant",
                "content": msg.get("content") or "",
                "tool_calls": tool_calls,
            }
        )
        for tc in tool_calls:
            fn = tc.get("function") or {}
            name = fn.get("name") or ""
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            handler = tools.FUNCTION_MAP.get(name)
            if handler is None:
                result = {
                    "ok": False,
                    "mensaje": f"La acción '{name}' no está disponible.",
                }
            else:
                try:
                    result = await handler(args, ctx)
                except Exception as exc:  # noqa: BLE001 - el modelo debe poder seguir
                    log.exception("Error en herramienta %s", name)
                    result = {
                        "ok": False,
                        "mensaje": f"Ocurrió un error al ejecutar la acción: {exc}",
                    }
            log.info("tool %s args=%s -> %s", name, args, str(result)[:120])
            messages.append(
                {
                    "role": "tool",
                    "tool_call_id": tc.get("id") or "",
                    "content": json.dumps(result, ensure_ascii=False),
                }
            )

        # Seguir el loop (el modelo procesa los resultados y decide si continúa)
        continue

    log.warning("Loop de herramientas agotado para %s", session_id)
    return {
        "reply": "Lo siento, no pude completar la solicitud. Inténtalo de nuevo por favor.",
        "payload": ctx.get("payload") or {},
    }
