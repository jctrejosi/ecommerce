#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Experimento: probar variantes del paquete ACE32 CONNECT contra el servidor."""
import socket
import struct

HOST, PORT = "89.117.149.145", 2000
USER, PWD = b"AdsSys", b"Pubdata"


def chk(packet: bytes, idx: int = 4) -> int:
    total = sum(packet[:idx] + packet[idx + 1:])
    return (0x100 - (total & 0xFF)) & 0xFF


def variant(name, header_fmt, body_order, extra=None):
    """header_fmt: struct format (16, 17 o 20 bytes). body_order: 'pwd_user'/'user_pwd'."""
    body = struct.pack("<BBBB", 12, 0, 2, 0)  # major, minor, server_type=REMOTE, encryption=none
    pw = PWD[:20] + b"\x00"
    us = USER[:24] + b"\x00"
    body += (pw + us) if body_order == "pwd_user" else (us + pw)

    hdr_size = struct.calcsize(header_fmt)
    length = hdr_size + len(body)
    fields = [0x02, 0, length, 0, 0, 0, 0, 0]  # type, num, len, txn, chk, rsv, seq, handle
    if extra:
        fields.extend(extra)
    hdr = bytearray(struct.pack(header_fmt, *fields))
    hdr[4] = chk(bytes(hdr))
    return name, bytes(hdr) + body


def try_send(name, pkt, timeout=5.0):
    try:
        s = socket.create_connection((HOST, PORT), timeout=timeout)
        s.settimeout(timeout)
        s.sendall(pkt)
        try:
            data = s.recv(4096)
            if not data:
                return f"{name}: cerró sin datos"
            return (f"{name}: RESP {len(data)}B tipo=0x{data[0]:02x} "
                    f"len={struct.unpack_from('<H', data, 2)[0]} hex={data.hex(' ')[:120]}")
        except socket.timeout:
            return f"{name}: timeout (sin respuesta)"
        finally:
            s.close()
    except OSError as exc:
        return f"{name}: error {exc}"


H16 = "<BBHHBBII"    # txn(2) checksum(1) reserved(1) — layout original
H16b = "<BBHBBHII"   # checksum(1) reserved(1) txn(2)
H17 = "<BBHHBBIIB"   # 16 + version byte
H17b = "<BBHBBHIIB"  # 16b + version byte
H20 = "<BBHHBBIII"   # 20 bytes (16 + 1 DWORD extra)

variants = [
    variant("A16 pwd_user txn@4", H16, "pwd_user"),
    variant("B16 user_pwd txn@4", H16, "user_pwd"),
    variant("C16b pwd_user chk@4", H16b, "pwd_user"),
    variant("D17 pwd_user ver=0", H17, "pwd_user", [0]),
    variant("E17 pwd_user ver=1", H17, "pwd_user", [1]),
    variant("F17 pwd_user ver=0x10", H17, "pwd_user", [0x10]),
    variant("G17b pwd_user chk@4 ver=0", H17b, "pwd_user", [0]),
    variant("H20 pwd_user extra=0", H20, "pwd_user", [0]),
]

for name, pkt in variants:
    print(try_send(name, pkt))
