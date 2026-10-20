"""Limitador de tasa en memoria (ventana fija) para el bot de compras.

Motivo: `POST /chat` consume crédito de la API de DeepSeek (y los endpoints de
carrito escriben en la BD), así que un cliente abusivo puede generar coste o
saturar el servicio. No depende de servicios externos.

El bot solo escucha en 127.0.0.1 dentro del contenedor (solo Caddy lo alcanza),
por eso `X-Forwarded-For` es fiable aquí para identificar al cliente real.

Variables de entorno:
- ``CHAT_RATE_LIMIT``   peticiones por IP y ventana (def. 20)
- ``CHAT_RATE_WINDOW``  segundos de la ventana        (def. 60)
"""

from __future__ import annotations

import os
import time
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse

# Rutas que gastan DeepSeek o mutan el carrito.
_PROTECTED_PREFIXES = ("/chat", "/cart")


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name) or default)
    except ValueError:
        return default
    return value if value > 0 else default


LIMIT = _int_env("CHAT_RATE_LIMIT", 20)
WINDOW = _int_env("CHAT_RATE_WINDOW", 60)

# ip -> (reset_at monotónico, peticiones contadas)
_buckets: dict[str, tuple[float, int]] = {}


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _cleanup(now: float) -> None:
    if len(_buckets) < 512:
        return
    for ip, (reset_at, _) in list(_buckets.items()):
        if reset_at <= now:
            _buckets.pop(ip, None)


async def rate_limit_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith(_PROTECTED_PREFIXES):
        return await call_next(request)

    now = time.monotonic()
    _cleanup(now)
    ip = _client_ip(request)
    reset_at, count = _buckets.get(ip, (0.0, 0))

    if reset_at <= now:
        _buckets[ip] = (now + WINDOW, 1)
        return await call_next(request)

    if count >= LIMIT:
        retry_after = max(1, int(reset_at - now))
        return JSONResponse(
            status_code=429,
            content={"detail": "Demasiadas peticiones. Espera un momento e inténtalo de nuevo."},
            headers={"Retry-After": str(retry_after)},
        )

    _buckets[ip] = (reset_at, count + 1)
    return await call_next(request)
