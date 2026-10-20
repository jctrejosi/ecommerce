"""API del bot de compras Mercaldas.

Endpoints:
- GET  /health         → estado del servicio + BD
- GET  /chat/options   → opciones rápidas del widget
- POST /chat           → conversación (mensaje + historial) → respuesta + payload
"""
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, database, deepseek, tools, cart
from .rate_limit import rate_limit_middleware

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
log = logging.getLogger("bot.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Iniciando bot de compras Mercaldas…")
    try:
        ok = await database.ping()
        log.info("Conexión a la BD: %s", "OK" if ok else "FALLÓ")
        if ok:
            # Sesiones/carritos viejos de chats anteriores (cada apertura del
            # chat crea una sesión nueva; esto evita acumular basura en la BD).
            try:
                carts, sessions = await cart.cleanup_expired()
                if carts or sessions:
                    log.info("Limpieza: %s carritos y %s sesiones expiradas borradas", carts, sessions)
            except Exception:  # noqa: BLE001
                log.warning("No se pudo limpiar sesiones expiradas", exc_info=True)
    except Exception as exc:  # noqa: BLE001 - no impedir el arranque
        log.warning("No se pudo validar la BD al arrancar: %s", exc)
    yield
    await database.close_pool()


app = FastAPI(
    title="Mercaldas Shopping Bot API",
    description="Chatbot de compras con DeepSeek function calling. Arma el carrito consultando la BD.",
    version="0.1.0",
    lifespan=lifespan,
)

# Limitador de tasa propio (ver app/rate_limit.py). Se registra ANTES que CORS
# para que CORS quede por fuera y las respuestas 429 lleven cabeceras CORS.
app.middleware("http")(rate_limit_middleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class HistoryMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    branch_id: Optional[int] = None
    history: list[HistoryMessage] = Field(default_factory=list)


class ChatResponse(BaseModel):
    reply: str
    session_id: str
    payload: dict = Field(default_factory=dict)


@app.get("/health")
async def health():
    db_ok = False
    try:
        db_ok = await database.ping()
    except Exception:  # noqa: BLE001
        db_ok = False
    return {
        "status": "ok" if db_ok else "degraded",
        "database": "connected" if db_ok else "disconnected",
        "model": config.DEEPSEEK_MODEL,
    }


@app.get("/chat/options")
async def chat_options():
    return {"options": await tools.get_enabled_quick_options()}


class CartItemRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    product_id: int = Field(..., gt=0)
    quantity: int = Field(1, ge=0)


class SuggestRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    limite: int = Field(6, ge=1, le=12)


async def _resolve_variant(product_id: int) -> dict:
    variant = await database.get_variant_for_product(product_id)
    if not variant:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return variant


@app.get("/cart")
async def get_cart(session_id: str):
    """Estado actual del carrito de la sesión (para el modal del web client)."""
    return await cart.get_cart(session_id)


@app.post("/cart/items")
async def add_cart_item(req: CartItemRequest):
    """Agrega (incrementa) un producto al carrito de la sesión."""
    variant = await _resolve_variant(req.product_id)
    stock = await database.get_stock(variant["variant_id"])
    if stock is not None and stock <= 0:
        raise HTTPException(status_code=400, detail="El producto está agotado")
    return await cart.add_item(
        session_id=req.session_id,
        variant_id=variant["variant_id"],
        quantity=max(1, req.quantity),
        unit_price=float(variant["price"] or 0),
    )


@app.post("/cart/items/set")
async def set_cart_item(req: CartItemRequest):
    """Fija la cantidad exacta de un producto (0 lo elimina)."""
    variant = await _resolve_variant(req.product_id)
    return await cart.set_quantity(
        session_id=req.session_id,
        variant_id=variant["variant_id"],
        quantity=max(0, req.quantity),
    )


@app.get("/catalog/suggestions")
async def catalog_suggestions(limite: int = 8):
    """Lista sugerida de productos (ofertas primero) para el primer contacto."""
    products = await database.get_suggested_products(limit=limite)
    return {"products": products}


@app.get("/catalog/search")
async def catalog_search(
    query: str = "",
    categoria: str = "",
    marca: str = "",
    limite: int = 8,
):
    """Búsqueda de productos para el modal (opciones seleccionables)."""
    products = await database.search_products(
        query=query,
        category=categoria,
        brand=marca,
        limit=limite,
    )
    return {"products": products}


@app.post("/cart/suggest")
async def cart_suggest(req: SuggestRequest):
    """Arma la lista sugerida de base (si el carrito está vacío).
    Devuelve `{cart, products}` para que el modal muestre el carrito
    ya poblado + opciones seleccionables."""
    return await cart.suggest_cart(
        session_id=req.session_id,
        limit=req.limite,
    )


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    if not config.DEEPSEEK_API_KEY:
        raise HTTPException(status_code=503, detail="DEEPSEEK_API_KEY no está configurada")

    session_id = req.session_id or str(uuid.uuid4())
    history = [h.model_dump() for h in req.history]

    try:
        result = await deepseek.chat_with_tools(
            session_id=session_id,
            user_message=req.message,
            history=history,
            branch_id=req.branch_id,
        )
    except Exception as exc:  # noqa: BLE001
        log.exception("Error procesando chat")
        raise HTTPException(status_code=502, detail=f"Error del proveedor de IA: {exc}") from exc

    return ChatResponse(
        reply=result["reply"],
        session_id=session_id,
        payload=result.get("payload") or {},
    )
