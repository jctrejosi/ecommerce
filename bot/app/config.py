"""Configuración del bot desde variables de entorno."""
import os

from dotenv import load_dotenv

load_dotenv()


def _ssl_ctx():
    """Contexto SSL sin verificación (comportamiento equivalente al backend
    Node con `ssl: { rejectUnauthorized: false }` para Supabase)."""
    import ssl

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


DATABASE_URL = os.getenv("DATABASE_URL", "")
DB_SSL = os.getenv("DB_SSL", "false").lower() == "true"

DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_MODEL = os.getenv("DEEPSEEK_MODEL", "deepseek-v4-flash")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com")
DEEPSEEK_TIMEOUT = float(os.getenv("DEEPSEEK_TIMEOUT", "45"))

PORT = int(os.getenv("BOT_API_PORT", "8000"))
CORS_ORIGINS = [
    o.strip()
    for o in os.getenv("CORS_ORIGIN", "http://localhost:5173").split(",")
    if o.strip()
]

MAX_HISTORY = int(os.getenv("BOT_MAX_HISTORY", "12"))
MAX_TOKENS = int(os.getenv("BOT_MAX_TOKENS", "2000"))
MAX_TOOL_ROUNDS = int(os.getenv("BOT_MAX_TOOL_ROUNDS", "6"))


def get_ssl():
    """Devuelve el argumento `ssl` para asyncpg."""
    if not DB_SSL:
        return False
    return _ssl_ctx()
