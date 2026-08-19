# -*- coding: utf-8 -*-
"""Capa de acceso a Advantage Database Server vía pyodbc (driver ODBC de Windows).

En Linux el "Advantage ODBC Driver" no existe, así que la conexión real solo
funciona en la máquina Windows con el driver instalado. Para desarrollo local
sin la base se puede activar ADS_DEMO=1 (datos de ejemplo).
"""

import datetime
import decimal

import pyodbc

from .config import Settings

Row = dict[str, object]


class DatabaseError(Exception):
    """Error de base de datos (conexión o consulta)."""


class Database:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._conn: pyodbc.Connection | None = None

    # ---------------------------------------------------------------- conexión
    def connect(self) -> pyodbc.Connection:
        if self._conn is not None:
            try:
                if not self._conn.closed:
                    return self._conn
            except Exception:
                pass
            self._conn = None
        try:
            self._conn = pyodbc.connect(self.settings.conn_str, timeout=15)
        except pyodbc.Error as exc:
            msg = (
                f"No se pudo conectar a {self.settings.server}:{self.settings.port}: {exc}"
                + "\n¿El Advantage ODBC Driver está instalado? (solo Windows)"
            )
            raise DatabaseError(msg) from exc
        return self._conn

    def close(self) -> None:
        if self._conn is not None:
            try:
                self._conn.close()
            except Exception:
                pass
            self._conn = None

    # ---------------------------------------------------------------- utilidades
    def columns(self) -> list[str]:
        """Columnas de la tabla (en orden)."""
        conn = self.connect()
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT * FROM {self.settings.table} WHERE 1 = 0")
            return [col[0] for col in cur.description]
        except pyodbc.Error as exc:
            raise DatabaseError(f"Error leyendo columnas de {self.settings.table}: {exc}") from exc

    def key_column(self) -> str:
        """Clave de la tabla: configuración explícita o auto-detección."""
        if self.settings.key_column:
            return self.settings.key_column
        cols = [c.lower() for c in self.columns()]
        for candidate in ("codigo", "cod", "id", "prov_cod", "codprov"):
            if candidate in cols:
                return next(c for c in self.columns() if c.lower() == candidate)
        raise DatabaseError(
            "No se pudo auto-detectar la columna clave. Usa ADS_KEY_COLUMN=<columna>"
        )

    def count(self) -> int:
        conn = self.connect()
        try:
            cur = conn.cursor()
            cur.execute(f"SELECT COUNT(*) FROM {self.settings.table}")
            row = cur.fetchone()
            return int(row[0]) if row else 0
        except pyodbc.Error as exc:
            raise DatabaseError(f"Error contando filas de {self.settings.table}: {exc}") from exc

    def fetch_rows(self, limit: int, offset: int) -> list[Row]:
        """Devuelve filas como dicts {columna: valor}."""
        conn = self.connect()
        try:
            cur = conn.cursor()
            # SELECT TOP n es soportado por ADS; el offset se aplica descartando.
            sql = f"SELECT TOP {limit + offset} * FROM {self.settings.table}"
            cur.execute(sql)
            cols = [c[0] for c in cur.description]
            rows: list[Row] = []
            for _ in range(offset):  # saltar el offset
                if not cur.fetchone():
                    return rows
            for row in cur.fetchmany(limit):
                rows.append({c: _to_jsonable(v) for c, v in zip(cols, row)})
            return rows
        except pyodbc.Error as exc:
            raise DatabaseError(f"Error consultando {self.settings.table}: {exc}") from exc

    def fetch_by_key(self, key: str) -> Row | None:
        """Fila por clave, con parámetro enlazado (sin inyección SQL)."""
        kcol = self.key_column()
        conn = self.connect()
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT * FROM {self.settings.table} WHERE {kcol} = ?", (key,)
            )
            cols = [c[0] for c in cur.description]
            row = cur.fetchone()
            if row is None:
                return None
            return {c: _to_jsonable(v) for c, v in zip(cols, row)}
        except pyodbc.Error as exc:
            raise DatabaseError(f"Error consultando {self.settings.table}: {exc}") from exc


def _to_jsonable(value: object) -> object:
    """Convierte tipos de ADS/pyodbc a tipos serializables por JSON."""
    if value is None:
        return None
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (datetime.datetime, datetime.date, datetime.time)):
        return value.isoformat()
    if isinstance(value, bytes):
        return value.decode("latin-1", errors="replace")
    if isinstance(value, str):
        return value.rstrip()  # los CHAR de ADS llegan con espacios a la derecha
    return value


# ---------------------------------------------------------------- modo demo
def demo_rows(limit: int, offset: int) -> list[Row]:
    """Datos de ejemplo para probar la API sin la base real (ADS_DEMO=1)."""
    import random

    random.seed(42)
    proveedores = [
        ("P0001", "Distribuidora Mercal C.A.", "J-12345678-9", "Caracas"),
        ("P0002", "Inversiones Delta S.A.", "J-23456789-0", "Maracaibo"),
        ("P0003", "Alimentos Polar del Centro", "J-34567890-1", "Valencia"),
        ("P0004", "Suplidora Nacional 2024", "J-45678901-2", "Barquisimeto"),
        ("P0005", "Proveedora Andina C.A.", "J-56789012-3", "Mérida"),
    ]
    rows = []
    for i in range(offset, offset + limit):
        codigo, nombre, rif, ciudad = proveedores[i % len(proveedores)]
        rows.append(
            {
                "CODIGO": codigo,
                "NOMBRE": f"{nombre} {i + 1}",
                "RIF": rif,
                "CIUDAD": ciudad,
                "SALDO": round(random.uniform(100, 5000), 2),
            }
        )
    return rows


def demo_count() -> int:
    return 120
