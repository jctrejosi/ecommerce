#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Probe del protocolo ACE32 (Advantage Database Server) por sockets puros.

Permite verificar desde Linux (o cualquier SO) que:
  1) El servidor en host:puerto responde el handshake ACE32.
  2) Las credenciales (usuario/contraseña) son aceptadas.
  3) Qué versión de ADS corre en el servidor.

No requiere el driver ODBC de Windows: habla directo el protocolo ACE32.

Referencia del protocolo: "Advantage Client Engine SDK" (ace32.h) de SAP.
Uso:
  test_db/venv/bin/python test_db/ace32_probe.py
  ADS_SERVER=... ADS_PORT=... ADS_UID=... ADS_PWD=... test_db/venv/bin/python test_db/ace32_probe.py
"""

import os
import socket
import struct
import sys

# --- Constantes del protocolo ACE32 ---
ACE32_PACKET_CONNECT = 0x02
ACE32_PACKET_CONNECT_RESPONSE = 0x04
ACE32_PACKET_ERROR = 0x0F

ACE32_REMOTE_SERVER = 0x02
ACE32_NO_ENCRYPTION = 0x00

ACE32_HEADER = struct.Struct("<BBHHBBII")  # 16 bytes


def checksum(packet: bytes) -> int:
    """Suma de bytes (excepto el propio checksum) y complemento a 2."""
    total = sum(packet[:4] + packet[5:])
    return (0x100 - (total & 0xFF)) & 0xFF


def build_connect(user: str, pwd: str, seq: int = 0, handle: int = 0) -> bytes:
    # Cuerpo: version mayor/menor del cliente, tipo de servidor, cifrado,
    # password terminada en NUL, usuario terminado en NUL.
    body = struct.pack(
        "<BBBB",
        12,  # usMajorVersion
        0,   # usMinorVersion
        ACE32_REMOTE_SERVER,
        ACE32_NO_ENCRYPTION,
    )
    body += pwd.encode("ascii", "replace")[:20] + b"\x00"
    body += user.encode("ascii", "replace")[:24] + b"\x00"

    length = ACE32_HEADER.size + len(body)
    header = bytearray(
        ACE32_HEADER.pack(
            ACE32_PACKET_CONNECT,
            0,       # usPacketNumber
            length,  # ulLen
            0,       # usTransactionNumber
            0,       # usChecksum (se rellena abajo)
            0,       # ucReserved
            seq,
            handle,
        )
    )
    header[4] = checksum(bytes(header))
    return bytes(header) + body


def parse_connect_response(data: bytes) -> dict[str, object]:
    info: dict[str, object] = {
        "raw_hex": data.hex(" "),
        "packet_type": data[0] if data else None,
        "length": struct.unpack_from("<H", data, 2)[0] if len(data) >= 4 else None,
        "result": data[16] if len(data) >= 17 else None,
    }
    if len(data) >= 20:
        info["server_major"] = data[17]
        info["server_minor"] = data[18]
        info["encryption"] = data[19]
    if len(data) >= 22:
        info["server_build"] = struct.unpack_from("<H", data, 20)[0]
    return info


def probe(server: str, port: int, user: str, pwd: str, timeout: float = 10.0) -> int:
    print(f"==> ACE32 probe -> {server}:{port}  (usuario: {user})")

    sock = socket.create_connection((server, port), timeout=timeout)
    try:
        pkt = build_connect(user, pwd)
        sock.sendall(pkt)
        print(f"    Enviado CONNECT ({len(pkt)} bytes)")

        sock.settimeout(timeout)
        data = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            data += chunk
            if len(data) >= 16:
                expected = struct.unpack_from("<H", data, 2)[0]
                if len(data) >= expected:
                    break

        if not data:
            print("    El servidor cerró la conexión sin responder.")
            return 1

        info = parse_connect_response(data)
        ptype = info["packet_type"]

        if ptype == ACE32_PACKET_CONNECT_RESPONSE:
            if info["result"] == 0x01:
                msg = (
                    "OK  Conexión ACE32 aceptada "
                    f"(servidor ADS {info.get('server_major')}.{info.get('server_minor')}"
                    f" build {info.get('server_build')}, cifrado={info.get('encryption')})"
                )
                print(msg)
                return 0
            msg = "ERROR  Servidor rechazó las credenciales " + f"(result=0x{info['result']:02x})"
            print(msg)
            print(f"    Respuesta cruda: {info['raw_hex']}")
            return 2
        if ptype == ACE32_PACKET_ERROR:
            print("    El servidor respondió un paquete de ERROR ACE32.")
            print(f"    Respuesta cruda: {info['raw_hex']}")
            return 3
        print(f"    Respuesta inesperada (tipo 0x{ptype:02x}).")
        print(f"    Respuesta cruda: {info['raw_hex']}")
        return 4
    finally:
        sock.close()


def main() -> int:
    server = os.environ.get("ADS_SERVER", "89.117.149.145")
    port = int(os.environ.get("ADS_PORT", "2000"))
    user = os.environ.get("ADS_UID", "AdsSys")
    pwd = os.environ.get("ADS_PWD", "Pubdata")
    try:
        rc = probe(server, port, user, pwd)
    except socket.timeout:
        print("    TIMEOUT  El servidor no respondió el handshake ACE32.")
        return 5
    except OSError as exc:
        print(f"    ERROR de red: {exc}")
        return 6
    print(f"\nResultado: {'OK' if rc == 0 else 'FALLO'} (código {rc})")
    return rc


if __name__ == "__main__":
    sys.exit(main())
