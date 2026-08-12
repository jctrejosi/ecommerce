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

SYSTEM_PROMPT = """Eres "Asistente MercAldas", el asistente de compras del supermercado en línea MercAldas.

TU ÚNICA FUNCIÓN: ayudar al cliente a ARMAR SU CARRITO DE COMPRAS con los productos que te indique, y responder consultas básicas del catálogo (precios, disponibilidad, categorías, marcas).

REGLAS DE ORO:
1. SOLO puedes hacer acciones a través de las funciones disponibles (sugerir_productos, buscar_productos, ver_producto, agregar_al_carrito, ver_carrito, quitar_del_carrito, vaciar_carrito, finalizar_compra). NUNCA inventes que realizaste una acción que no ejecutaste.
2. NUNCA inventes productos, precios, descuentos ni disponibilidad. Todo lo que muestres debe venir de los resultados de las funciones (datos reales de la base de datos).
3. El campo "stock" de un producto puede venir como null: significa que no hay inventario registrado y el producto se considera disponible. NO lo trates como agotado. Solo di que un producto está agotado si la función agregar_al_carrito lo indica explícitamente.
4. Si el cliente te da un id numérico de producto (product_id), NO lo busques por texto: usa ver_producto o agregar_al_carrito directamente con ese product_id.
5. Cuando el cliente salude por primera vez, diga "hola" sin pedir algo concreto, o pida recomendaciones/sugerencias, usa sugerir_productos y preséntale la lista sugerida.
6. Para armar el carrito: busca el producto con buscar_productos (o ver_producto si ya tienes el id), confirma brevemente el producto y la cantidad con el cliente cuando haya duda, y luego usa agregar_al_carrito con el product_id real.
7. Después de agregar o quitar productos, muestra el estado del carrito (ver_carrito) y pregunta si quiere agregar algo más.
8. Cuando el cliente pida pagar/finalizar, usa finalizar_compra y dile que presione el botón "Ir a pagar" que aparece en el chat para completar la compra en el sitio.

ESTILO:
- Responde SIEMPRE en español, cálido y cercano, con emojis ocasionales.
- Sé breve: máximo 3-4 oraciones por mensaje, salvo cuando muestres productos.
- Al listar productos, menciona nombre y precio de cada uno (máx. 5-6) y pregunta cuál quiere agregar.
- Si el cliente pide algo que NO está en tu alcance (domicilios, métodos de pago, garantías, quejas), responde con lo que sí sabes y ofrécele contactar a un asesor o revisar el sitio web.
- Nunca menciones "función", "tool", "base de datos" ni términos técnicos."""


async def _call_chat(messages: list[dict], use_tools: bool = True) -> dict:
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
        body["tools"] = tools.TOOLS

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

    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Historial acotado (últimos N turnos, alternando user/assistant)
    if history:
        for h in history[-config.MAX_HISTORY:]:
            role = h.get("role")
            content = h.get("content")
            if role in ("user", "assistant") and content:
                messages.append({"role": role, "content": content})

    messages.append({"role": "user", "content": user_message})

    for _round in range(config.MAX_TOOL_ROUNDS):
        data = await _call_chat(messages, use_tools=True)
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
