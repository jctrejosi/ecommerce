"""Fixtures comunes para las pruebas del bot.

IMPORTANTE: las variables de entorno se definen ANTES de importar `app.*`,
porque `app.config` y `app.rate_limit` leen el entorno al importarse. Los
valores son falsos: las pruebas nunca contactan la BD ni la API real de
DeepSeek. `load_dotenv()` no sobrescribe variables ya presentes, así que un
`.env` local no altera este setup.
"""
import os

os.environ.update(
    {
        # Puerto 1: si alguna prueba intentara conectarse de verdad, falla al
        # instante en vez de alcanzar un PostgreSQL local.
        "DATABASE_URL": "postgresql://bot:secret@127.0.0.1:1/bot_tests",
        "DB_SSL": "false",
        "DEEPSEEK_API_KEY": "test-key-no-real",
        "DEEPSEEK_MODEL": "deepseek-test",
        "DEEPSEEK_API_URL": "http://deepseek.invalid",
        "DEEPSEEK_TIMEOUT": "1",
        "BOT_API_PORT": "8000",
        "CORS_ORIGIN": "http://localhost:5173",
        "BOT_MAX_HISTORY": "12",
        "BOT_MAX_TOKENS": "2000",
        "BOT_MAX_TOOL_ROUNDS": "6",
        "CHAT_RATE_LIMIT": "1000",
        "CHAT_RATE_WINDOW": "60",
    }
)

import asyncpg  # noqa: E402
import httpx  # noqa: E402
import pytest  # noqa: E402

from app import config, rate_limit  # noqa: E402
from app.main import app as fastapi_app  # noqa: E402


@pytest.fixture(autouse=True)
def _prohibir_bd_real(request, monkeypatch):
    """Red de seguridad: ninguna prueba unitaria abre conexiones reales.

    Las pruebas marcadas `integration` sí usan PostgreSQL (Testcontainers).
    """
    if request.node.get_closest_marker("integration"):
        yield
        return

    async def _prohibido(*args, **kwargs):
        raise RuntimeError(
            "Una prueba intentó abrir una conexión real a PostgreSQL; "
            "mockea app.database o marca la prueba como integration."
        )

    monkeypatch.setattr(asyncpg, "create_pool", _prohibido)
    monkeypatch.setattr(asyncpg, "connect", _prohibido)
    yield


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    """Cada test arranca con los buckets del limitador vacíos."""
    rate_limit._buckets.clear()
    yield
    rate_limit._buckets.clear()


@pytest.fixture
def app():
    """Instancia FastAPI bajo prueba."""
    return fastapi_app


@pytest.fixture
async def client(app):
    """Cliente httpx ASGI (no abre puertos ni red)."""
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://bot.test") as c:
        yield c


@pytest.fixture(autouse=True)
def _restore_config_module():
    """Restaura los atributos de `app.config` si algún test los recarga."""
    snapshot = {k: v for k, v in vars(config).items() if k.isupper()}
    yield
    for name, value in snapshot.items():
        setattr(config, name, value)
