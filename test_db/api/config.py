# -*- coding: utf-8 -*-
"""Configuración de la API (todo vía variables de entorno)."""

import os


class Settings:
    def __init__(self) -> None:
        self.server: str = os.environ.get("ADS_SERVER", "89.117.149.145")
        self.port: int = int(os.environ.get("ADS_PORT", "2000"))
        self.database: str = os.environ.get(
            "ADS_DB", r"C:\VISADS_25\ADD\Publidata.add"
        )
        self.uid: str = os.environ.get("ADS_UID", "AdsSys")
        self.pwd: str = os.environ.get("ADS_PWD", "Pubdata")
        self.table: str = os.environ.get("ADS_TABLE", "PROVEE")
        # Columna usada como clave para GET /provee/{clave}.
        # Vacío = se auto-detecta (busca CODIGO/COD/ID entre las columnas).
        self.key_column: str = os.environ.get("ADS_KEY_COLUMN", "").strip()
        # Modo demo: sirve datos de ejemplo sin necesidad de driver/BD.
        self.demo: bool = os.environ.get("ADS_DEMO", "0") in ("1", "true", "True", "yes")

    @property
    def conn_str(self) -> str:
        return (
            f"DRIVER={{Advantage ODBC Driver}};"
            f"Server={self.server}:{self.port};"
            f"DataDirectory={self.database};"
            f"ServerTypes=2;"
            f"CommType=TCP_IP;"
            f"UID={self.uid};"
            f"PWD={self.pwd};"
        )

    def __repr__(self) -> str:  # sin exponer la contraseña
        return (
            f"Settings(server={self.server}:{self.port}, "
            f"database={self.database}, uid={self.uid}, "
            f"table={self.table}, key_column={self.key_column!r}, demo={self.demo})"
        )
