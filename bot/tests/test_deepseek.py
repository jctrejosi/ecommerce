"""Pruebas de `app/deepseek.py` con el cliente HTTP mockeado.

Nunca se llama a la API real: `httpx.AsyncClient` se reemplaza por un doble que
devuelve respuestas enlatadas y registra el cuerpo enviado.
"""
import json

import httpx
import pytest

from app import config, deepseek, tools


class FakeResponse:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            request = httpx.Request("POST", "http://fake.test")
            response = httpx.Response(self.status_code, request=request)
            raise httpx.HTTPStatusError(
                f"HTTP {self.status_code}", request=request, response=response
            )

    def json(self) -> dict:
        return self._payload


@pytest.fixture
def fake_api(monkeypatch):
    state = {"responses": [], "calls": [], "client_kwargs": None}

    class FakeAsyncClient:
        def __init__(self, **kwargs):
            state["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json=None):  # noqa: A002 - mismo nombre que httpx
            state["calls"].append({"url": url, "body": json})
            return FakeResponse(state["responses"].pop(0))

    monkeypatch.setattr(deepseek.httpx, "AsyncClient", FakeAsyncClient)
    return state


@pytest.fixture(autouse=True)
def _herramientas_habilitadas(monkeypatch):
    """Evita tocar la BD para leer la config del panel de bot."""

    async def fake_names():
        return {"buscar_productos", "ver_carrito"}

    async def fake_tools():
        return [
            t
            for t in tools.TOOLS
            if t["function"]["name"] in {"buscar_productos", "ver_carrito"}
        ]

    monkeypatch.setattr(tools, "enabled_function_names", fake_names)
    monkeypatch.setattr(tools, "get_enabled_tools", fake_tools)


def respuesta_chat(content=None, tool_calls=None, finish_reason="stop") -> dict:
    message = {"role": "assistant", "content": content}
    if tool_calls is not None:
        message["tool_calls"] = tool_calls
    return {"choices": [{"message": message, "finish_reason": finish_reason}]}


def tool_call(name="buscar_productos", arguments='{"query": "arroz"}', call_id="call-1"):
    return {
        "id": call_id,
        "type": "function",
        "function": {"name": name, "arguments": arguments},
    }


# ─── _call_chat ─────────────────────────────────────────────────


async def test_call_chat_sin_api_key_falla(monkeypatch):
    monkeypatch.setattr(config, "DEEPSEEK_API_KEY", "")
    with pytest.raises(RuntimeError, match="DEEPSEEK_API_KEY"):
        await deepseek._call_chat([{"role": "user", "content": "hola"}])


async def test_call_chat_envia_modelo_mensajes_y_tools(fake_api):
    fake_api["responses"].append(respuesta_chat(content="hola"))

    data = await deepseek._call_chat([{"role": "user", "content": "hola"}])

    assert data["choices"][0]["message"]["content"] == "hola"
    llamada = fake_api["calls"][0]
    assert llamada["url"] == "http://deepseek.invalid/chat/completions"
    assert llamada["body"]["model"] == "deepseek-test"
    assert llamada["body"]["messages"] == [{"role": "user", "content": "hola"}]
    assert llamada["body"]["temperature"] == 0.7
    assert llamada["body"]["max_tokens"] == config.MAX_TOKENS
    assert llamada["body"]["tools"] == tools.TOOLS
    assert fake_api["client_kwargs"]["headers"]["Authorization"].startswith("Bearer ")
    assert fake_api["client_kwargs"]["timeout"] == config.DEEPSEEK_TIMEOUT


async def test_call_chat_sin_tools(fake_api):
    fake_api["responses"].append(respuesta_chat(content="hola"))

    await deepseek._call_chat([{"role": "user", "content": "hola"}], use_tools=False)

    assert "tools" not in fake_api["calls"][0]["body"]


async def test_call_chat_usa_lista_de_tools_explicita(fake_api):
    fake_api["responses"].append(respuesta_chat(content="hola"))
    lista = [{"type": "function", "function": {"name": "x", "parameters": {}}}]

    await deepseek._call_chat([], tools_list=lista)

    assert fake_api["calls"][0]["body"]["tools"] == lista


async def test_call_chat_propaga_errores_http(monkeypatch):
    class FakeAsyncClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json=None):
            request = httpx.Request("POST", url)
            response = httpx.Response(500, request=request)
            raise httpx.HTTPStatusError("boom", request=request, response=response)

    monkeypatch.setattr(deepseek.httpx, "AsyncClient", FakeAsyncClient)

    with pytest.raises(httpx.HTTPStatusError):
        await deepseek._call_chat([])


# ─── chat_with_tools ────────────────────────────────────────────


async def test_chat_with_tools_respuesta_directa(fake_api):
    fake_api["responses"].append(respuesta_chat(content="  ¡Hola! Soy Daisy 😊  "))

    result = await deepseek.chat_with_tools("s-1", "hola")

    assert result == {"reply": "¡Hola! Soy Daisy 😊", "payload": {}}
    system = fake_api["calls"][0]["body"]["messages"][0]
    assert system["role"] == "system"
    assert "buscar_productos" in system["content"]
    assert "ver_carrito" in system["content"]
    assert "{FUNCIONES}" not in system["content"]


async def test_chat_with_tools_respuesta_vacia_usa_fallback(fake_api):
    fake_api["responses"].append(respuesta_chat(content="   "))

    result = await deepseek.chat_with_tools("s-1", "hola")

    assert "¿En qué más puedo ayudarte" in result["reply"]


async def test_chat_with_tools_incluye_historial_valido(fake_api, monkeypatch):
    monkeypatch.setattr(config, "MAX_HISTORY", 3)
    fake_api["responses"].append(respuesta_chat(content="ok"))

    history = [
        {"role": "system", "content": "ignorado"},
        {"role": "user", "content": "uno"},
        {"role": "assistant", "content": "dos"},
        {"role": "user", "content": "tres"},
        {"role": "assistant", "content": ""},
        {"role": "user", "content": "cuatro"},
    ]

    await deepseek.chat_with_tools("s-1", "mensaje actual", history=history)

    mensajes = fake_api["calls"][0]["body"]["messages"]
    assert mensajes[1:] == [
        {"role": "user", "content": "tres"},
        {"role": "user", "content": "cuatro"},
        {"role": "user", "content": "mensaje actual"},
    ]


async def test_chat_with_tools_ejecuta_tool_y_devuelve_payload(fake_api, monkeypatch):
    llamadas = []

    async def fake_buscar(args, ctx):
        llamadas.append((args, ctx["session_id"]))
        ctx.setdefault("payload", {})["products"] = [{"product_id": 1, "name": "Arroz"}]
        return {"ok": True, "total": 1}

    monkeypatch.setitem(tools.FUNCTION_MAP, "buscar_productos", fake_buscar)
    fake_api["responses"].extend(
        [
            respuesta_chat(tool_calls=[tool_call()], finish_reason="tool_calls"),
            respuesta_chat(content="Encontré arroz."),
        ]
    )

    result = await deepseek.chat_with_tools("s-1", "busca arroz")

    assert result["reply"] == "Encontré arroz."
    assert result["payload"]["products"] == [{"product_id": 1, "name": "Arroz"}]
    assert llamadas == [({"query": "arroz"}, "s-1")]

    segunda_llamada = fake_api["calls"][1]["body"]["messages"]
    assert segunda_llamada[-2]["role"] == "assistant"
    assert segunda_llamada[-2]["tool_calls"][0]["id"] == "call-1"
    assert segunda_llamada[-1]["role"] == "tool"
    assert segunda_llamada[-1]["tool_call_id"] == "call-1"
    assert json.loads(segunda_llamada[-1]["content"]) == {"ok": True, "total": 1}


async def test_chat_with_tools_herramienta_desconocida(fake_api):
    fake_api["responses"].extend(
        [
            respuesta_chat(tool_calls=[tool_call(name="hackear_planeta")]),
            respuesta_chat(content="No puedo."),
        ]
    )

    result = await deepseek.chat_with_tools("s-1", "haz algo")

    assert result["reply"] == "No puedo."
    tool_message = fake_api["calls"][1]["body"]["messages"][-1]
    contenido = json.loads(tool_message["content"])
    assert contenido["ok"] is False
    assert "no está disponible" in contenido["mensaje"]


async def test_chat_with_tools_argumentos_json_invalidos_se_tratan_como_vacios(
    fake_api, monkeypatch
):
    capturado = {}

    async def fake_buscar(args, ctx):
        capturado.update(args)
        return {"ok": True}

    monkeypatch.setitem(tools.FUNCTION_MAP, "buscar_productos", fake_buscar)
    fake_api["responses"].extend(
        [
            respuesta_chat(tool_calls=[tool_call(arguments="{no-es-json")]),
            respuesta_chat(content="Listo."),
        ]
    )

    await deepseek.chat_with_tools("s-1", "busca")
    assert capturado == {}


async def test_chat_with_tools_error_en_handler_no_rompe_el_loop(fake_api, monkeypatch):
    async def fake_buscar(args, ctx):
        raise ValueError("falló la búsqueda")

    monkeypatch.setitem(tools.FUNCTION_MAP, "buscar_productos", fake_buscar)
    fake_api["responses"].extend(
        [
            respuesta_chat(tool_calls=[tool_call()]),
            respuesta_chat(content="Hubo un problema."),
        ]
    )

    result = await deepseek.chat_with_tools("s-1", "busca")

    assert result["reply"] == "Hubo un problema."
    contenido = json.loads(fake_api["calls"][1]["body"]["messages"][-1]["content"])
    assert contenido["ok"] is False
    assert "falló la búsqueda" in contenido["mensaje"]


async def test_chat_with_tools_agota_el_loop(fake_api, monkeypatch):
    monkeypatch.setattr(config, "MAX_TOOL_ROUNDS", 2)

    async def fake_buscar(args, ctx):
        return {"ok": True}

    monkeypatch.setitem(tools.FUNCTION_MAP, "buscar_productos", fake_buscar)
    fake_api["responses"].extend(
        [
            respuesta_chat(tool_calls=[tool_call()]),
            respuesta_chat(tool_calls=[tool_call()]),
        ]
    )

    result = await deepseek.chat_with_tools("s-1", "busca")

    assert result["reply"] == (
        "Lo siento, no pude completar la solicitud. Inténtalo de nuevo por favor."
    )
    assert len(fake_api["calls"]) == 2


async def test_chat_with_tools_multiples_tool_calls_en_una_ronda(fake_api, monkeypatch):
    ejecutadas = []

    async def fake_buscar(args, ctx):
        ejecutadas.append("buscar")
        return {"ok": True}

    async def fake_ver(args, ctx):
        ejecutadas.append("ver")
        return {"ok": True}

    monkeypatch.setitem(tools.FUNCTION_MAP, "buscar_productos", fake_buscar)
    monkeypatch.setitem(tools.FUNCTION_MAP, "ver_carrito", fake_ver)
    fake_api["responses"].extend(
        [
            respuesta_chat(
                tool_calls=[
                    tool_call(name="buscar_productos", call_id="a"),
                    tool_call(name="ver_carrito", arguments="{}", call_id="b"),
                ]
            ),
            respuesta_chat(content="Listo."),
        ]
    )

    await deepseek.chat_with_tools("s-1", "busca y muestra")

    assert ejecutadas == ["buscar", "ver"]
    tool_messages = fake_api["calls"][1]["body"]["messages"][-2:]
    assert [m["tool_call_id"] for m in tool_messages] == ["a", "b"]


async def test_chat_with_tools_genera_session_uuid_segun_el_llamador(fake_api):
    """El módulo no inventa sesión: usa la que recibe y no la altera."""
    fake_api["responses"].append(respuesta_chat(content="ok"))

    await deepseek.chat_with_tools("sesion-fija", "hola")

    assert "sesion-fija" not in json.dumps(fake_api["calls"][0]["body"])
