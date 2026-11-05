"""Pruebas del parseo de configuración desde variables de entorno."""
import importlib
import ssl

import dotenv
import pytest

from app import config


@pytest.fixture(autouse=True)
def _no_dotenv(monkeypatch):
    """Evita que un `.env` local (bot/.env) influya en los asserts."""
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *args, **kwargs: False)


def _reload_with(monkeypatch, **env):
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    return importlib.reload(config)


def test_defaults_cuando_faltan_variables(monkeypatch):
    cfg = _reload_with(
        monkeypatch,
        DATABASE_URL=None,
        DB_SSL=None,
        DEEPSEEK_API_KEY=None,
        DEEPSEEK_MODEL=None,
        DEEPSEEK_API_URL=None,
        DEEPSEEK_TIMEOUT=None,
        BOT_API_PORT=None,
        CORS_ORIGIN=None,
        BOT_MAX_HISTORY=None,
        BOT_MAX_TOKENS=None,
        BOT_MAX_TOOL_ROUNDS=None,
    )

    assert cfg.DATABASE_URL == ""
    assert cfg.DB_SSL is False
    assert cfg.DEEPSEEK_API_KEY == ""
    assert cfg.DEEPSEEK_MODEL == "deepseek-v4-flash"
    assert cfg.DEEPSEEK_API_URL == "https://api.deepseek.com"
    assert cfg.DEEPSEEK_TIMEOUT == 45.0
    assert cfg.PORT == 8000
    assert cfg.CORS_ORIGINS == ["http://localhost:5173"]
    assert cfg.MAX_HISTORY == 12
    assert cfg.MAX_TOKENS == 2000
    assert cfg.MAX_TOOL_ROUNDS == 6


def test_parseo_de_valores(monkeypatch):
    cfg = _reload_with(
        monkeypatch,
        DATABASE_URL="postgresql://u:p@db:5432/ecommerce",
        DB_SSL="TRUE",
        DEEPSEEK_API_KEY="abc123",
        DEEPSEEK_MODEL="deepseek-custom",
        DEEPSEEK_API_URL="https://ia.example",
        DEEPSEEK_TIMEOUT="12.5",
        BOT_API_PORT="9100",
        BOT_MAX_HISTORY="5",
        BOT_MAX_TOKENS="512",
        BOT_MAX_TOOL_ROUNDS="3",
    )

    assert cfg.DATABASE_URL == "postgresql://u:p@db:5432/ecommerce"
    assert cfg.DB_SSL is True
    assert cfg.DEEPSEEK_API_KEY == "abc123"
    assert cfg.DEEPSEEK_MODEL == "deepseek-custom"
    assert cfg.DEEPSEEK_API_URL == "https://ia.example"
    assert cfg.DEEPSEEK_TIMEOUT == 12.5
    assert cfg.PORT == 9100
    assert cfg.MAX_HISTORY == 5
    assert cfg.MAX_TOKENS == 512
    assert cfg.MAX_TOOL_ROUNDS == 3


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("false", False),
        ("FALSE", False),
        ("0", False),
        ("true", True),
        ("True", True),
        ("1", False),  # solo la cadena 'true' activa SSL (comportamiento actual)
    ],
)
def test_db_ssl_solo_acepta_true(monkeypatch, raw, expected):
    cfg = _reload_with(monkeypatch, DB_SSL=raw)
    assert cfg.DB_SSL is expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("http://a.test", ["http://a.test"]),
        ("http://a.test, http://b.test", ["http://a.test", "http://b.test"]),
        ("http://a.test, ,http://b.test,", ["http://a.test", "http://b.test"]),
        ("", []),
    ],
)
def test_cors_origins_separa_por_coma(monkeypatch, raw, expected):
    cfg = _reload_with(monkeypatch, CORS_ORIGIN=raw)
    assert cfg.CORS_ORIGINS == expected


def test_puerto_no_numerico_falla_al_importar(monkeypatch):
    with pytest.raises(ValueError):
        _reload_with(monkeypatch, BOT_API_PORT="no-es-un-numero")


def test_get_ssl_desactivado(monkeypatch):
    monkeypatch.setattr(config, "DB_SSL", False)
    assert config.get_ssl() is False


def test_get_ssl_activo_devuelve_contexto_sin_verificacion(monkeypatch):
    monkeypatch.setattr(config, "DB_SSL", True)
    ctx = config.get_ssl()
    assert isinstance(ctx, ssl.SSLContext)
    assert ctx.check_hostname is False
    assert ctx.verify_mode == ssl.CERT_NONE
