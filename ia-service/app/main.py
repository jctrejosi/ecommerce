"""IA Service — API de generación de contenido para campañas de MercAldas.

POST /generate  → recomienda el contenido (whatsapp / email / sms) usando
                  DeepSeek con function calling (ver app/tools.py).
GET  /health    → estado del servicio.
"""
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from . import config, deepseek

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")

app = FastAPI(
    title="MercAldas IA Service",
    description="Recomendación de contenido de campañas con DeepSeek function calling.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Producto(BaseModel):
    nombre: str = "producto"
    precio: float | None = None
    descuento: float | None = None


class GenerateRequest(BaseModel):
    producto: Producto = Field(default_factory=Producto)
    prompt: str = ""
    tono: str = "cercano"
    canales: list[str] = Field(default_factory=lambda: ["whatsapp", "email", "sms"])


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "model": config.DEEPSEEK_MODEL,
        "api_key_configured": bool(config.DEEPSEEK_API_KEY),
    }


@app.post("/generate")
async def generate(req: GenerateRequest):
    canales = [c for c in req.canales if c in ("whatsapp", "email", "sms")]
    if not canales:
        raise HTTPException(
            status_code=400,
            detail="Indica al menos un canal válido: whatsapp, email o sms",
        )
    if not config.DEEPSEEK_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="DEEPSEEK_API_KEY no está configurada en el servicio ia-service",
        )

    resultado = await deepseek.generar_contenido(
        producto=req.producto.model_dump(),
        prompt=req.prompt,
        tono=req.tono,
        canales=canales,
    )
    return resultado
