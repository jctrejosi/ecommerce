#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prueba de conexión a Advantage Database Server (ADS) usando pyodbc.

IMPORTANTE:
- El "Advantage ODBC Driver" de SAP es SOLO para Windows.
  En Linux no existe driver ODBC para ADS, por lo que este script,
  en Linux, llegará hasta el chequeo de driver y fallará con un
  mensaje claro. Eso es el comportamiento esperado.
- Para probar la conexión real con pyodbc hay que ejecutar este
  mismo script en la máquina Windows (p. ej. vía el RDP con
  xfreerdp3) donde esté instalado el Advantage ODBC Driver.

Configuración vía variables de entorno (todas opcionales):
  ADS_SERVER  (default: 89.117.149.145)
  ADS_PORT    (default: 2000)
  ADS_DB      (default: C:\\VISADS_25\\ADD\\Publidata.add)
  ADS_UID     (default: AdsSys)
  ADS_PWD     (default: Pubdata)

Uso:
  test_db/venv/bin/python test_db/pyodbc_test.py
"""

import os
import socket
import sys


def env(k: str, default: str) -> str:
    return os.environ.get(k, default)


def main():
    server = env("ADS_SERVER", "89.117.149.145")
    port = int(env("ADS_PORT", "2000"))
    db = env("ADS_DB", r"C:\VISADS_25\ADD\Publidata.add")
    uid = env("ADS_UID", "AdsSys")
    pwd = env("ADS_PWD", "Pubdata")

    print(f"==> Destino: {server}:{port}  |  DB: {db}  |  Usuario: {uid}")

    # 1) Pre-chequeo de red (funciona en cualquier SO)
    try:
        with socket.create_connection((server, port), timeout=8):
            print(f"[1/3] OK  TCP {server}:{port} alcanzable")
    except OSError as exc:
        print(f"[1/3] ERROR  No se pudo conectar por TCP a {server}:{port}: {exc}")
        sys.exit(1)

    # 2) Chequeo del driver ODBC instalado
    try:
        import pyodbc
    except ImportError:
        print("[2/3] ERROR  pyodbc no está instalado. Ejecuta: pip install pyodbc")
        sys.exit(1)

    drivers = pyodbc.drivers()
    ads_drivers = [d for d in drivers if "advantage" in d.lower()]
    print(f"[2/3] OK  pyodbc {pyodbc.version} | drivers ODBC: {drivers or '(ninguno)'}")

    if not ads_drivers:
        print("[2/3] ERROR  No hay 'Advantage ODBC Driver' instalado.")
        print("       El Advantage ODBC Driver es exclusivo de Windows (SAP).")
        print("       En Linux no existe, por eso la conexión pyodbc NO puede")
        print("       completarse desde esta máquina.")
        print()
        print("       Solución: ejecuta este script en la máquina Windows")
        print("       (la del RDP 89.117.149.145) donde esté instalado el driver.")
        sys.exit(2)

    driver = ads_drivers[0]

    # 3) Conexión ODBC real
    # Keywords documentados del Advantage ODBC Driver (connectionstrings.com /
    # manual del driver): Server (host[:puerto]), DataDirectory, ServerTypes
    # (1=ALS, 2=ADS remoto, 3=ambos, 4=Internet), CommType, UID, PWD.
    conn_str = (
        f"DRIVER={{{driver}}};"
        f"Server={server}:{port};"
        f"DataDirectory={db};"
        f"ServerTypes=2;"
        f"CommType=TCP_IP;"
        f"UID={uid};"
        f"PWD={pwd};"
    )
    print(f"[3/3] Conectando con driver '{driver}' ...")
    try:
        conn = pyodbc.connect(conn_str, timeout=15)
    except pyodbc.Error as exc:
        print(f"[3/3] ERROR  {exc}")
        sys.exit(3)

    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM system.tables")
        print()
        print("=== TABLAS DISPONIBLES ===")
        for row in cur:
            print(row)
    finally:
        conn.close()

    print()
    print("OK  Conexión exitosa!")


if __name__ == "__main__":
    main()
