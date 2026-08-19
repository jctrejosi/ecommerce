# -*- coding: utf-8 -*-
"""API de ejemplo: tabla PROVEE de la base Publidata (Advantage Database Server).

Levantar (en Windows con el Advantage ODBC Driver instalado):

    test_db\\venv\\Scripts\\uvicorn api.main:app --host 0.0.0.0 --port 8000

Desde Linux, sin driver, se puede probar la API con datos de ejemplo:

    ADS_DEMO=1 test_db/venv/bin/uvicorn api.main:app --port 8000

Swagger: http://localhost:8000/docs
"""

import logging

from fastapi import FastAPI, HTTPException, Query

from .config import Settings
from .db import Database, DatabaseError, demo_count, demo_rows

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("api")

settings = Settings()
db = Database(settings)

app = FastAPI(
    title="API Publidata — PROVEE",
    description=(
        "Ejemplo de API FastAPI sobre la tabla PROVEE de la base "
        + "Publidata (Advantage Database Server vía pyodbc)."
        + f"\n\nConfiguración activa: `{settings}`"
        + (
            "\n\n⚠ **MODO DEMO** (ADS_DEMO=1): datos de ejemplo, sin base real."
            if settings.demo
            else ""
        )
    ),
    version="0.1.0",
)

if settings.demo:
    log.info("MODO DEMO activado — no se conectará a la base real")


def _db_error(exc: DatabaseError) -> HTTPException:
    log.error("Error de BD: %s", exc)
    return HTTPException(status_code=503, detail=str(exc))


@app.get("/")
def root() -> dict[str, object]:
    """Info básica de la API y de la configuración activa."""
    return {
        "api": "Publidata PROVEE",
        "version": app.version,
        "modo_demo": settings.demo,
        "servidor": f"{settings.server}:{settings.port}",
        "base": settings.database,
        "tabla": settings.table,
        "docs": "/docs",
    }


@app.get("/provee")
def list_provee(
    limit: int = Query(50, ge=1, le=500, description="Cantidad máxima de filas"),
    offset: int = Query(0, ge=0, description="Filas a saltar (paginación simple)"),
) -> dict[str, object]:
    """Lista de proveedores (filas de la tabla PROVEE)."""
    try:
        if settings.demo:
            rows = demo_rows(limit, offset)
            total = demo_count()
        else:
            rows = db.fetch_rows(limit, offset)
            total = db.count()
    except DatabaseError as exc:
        raise _db_error(exc) from exc
    return {"total": total, "devueltos": len(rows), "fila": rows}


@app.get("/provee/count")
def count_provee() -> dict[str, object]:
    """Cantidad total de filas de PROVEE."""
    try:
        total = demo_count() if settings.demo else db.count()
    except DatabaseError as exc:
        raise _db_error(exc) from exc
    return {"tabla": settings.table, "total": total}


@app.get("/provee/meta")
def meta_provee() -> dict[str, object]:
    """Columnas de la tabla y columna clave detectada (útil si el esquema cambia)."""
    try:
        if settings.demo:
            return {
                "tabla": settings.table,
                "modo": "demo",
                "columnas": ["CODIGO", "NOMBRE", "RIF", "CIUDAD", "SALDO"],
                "clave": settings.key_column or "CODIGO",
            }
        return {
            "tabla": settings.table,
            "modo": "real",
            "columnas": db.columns(),
            "clave": db.key_column(),
        }
    except DatabaseError as exc:
        raise _db_error(exc) from exc


@app.get("/provee/{clave}")
def get_provee(clave: str) -> dict[str, object]:
    """Una fila de PROVEE por su columna clave (auto-detectada o ADS_KEY_COLUMN)."""
    try:
        if settings.demo:
            for row in demo_rows(500, 0):
                if row["CODIGO"] == clave:
                    return {"fila": row}
            raise HTTPException(status_code=404, detail=f"No existe {settings.table} con clave {clave!r}")
        row = db.fetch_by_key(clave)
    except DatabaseError as exc:
        raise _db_error(exc) from exc
    if row is None:
        raise HTTPException(status_code=404, detail=f"No existe {settings.table} con clave {clave!r}")
    return {"fila": row}
