#!/usr/bin/env python3
"""
Intento de login al portal cautivo FortiGate de la UNAL (EstudiantesUN).

La contraseña NO se guarda en el archivo: se pasa por argumento (o por la
variable de entorno UNAL_PASS). El magic se obtiene en cada ejecución y se
reutiliza para los POST.

Uso:
    python3 unal-login.py <usuario> <password> [http_port] [https_port]
"""
import http.client
import ssl
import sys
import re
import os
import urllib.parse

HOST = "porta.unal.edu.co"

USER = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("UNAL_USER", "")
PASS = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("UNAL_PASS", "")
HTTP_PORT = int(sys.argv[3]) if len(sys.argv) > 3 else 1000
HTTPS_PORT = int(sys.argv[4]) if len(sys.argv) > 4 else 1000
REDIR = "http://neverssl.com"


def get_magic():
    """Pide una URL por HTTP; el interceptor devuelve el magic del portal."""
    c = http.client.HTTPConnection(HOST, HTTP_PORT, timeout=15)
    c.request("GET", "/", headers={"User-Agent": "Mozilla/5.0"})
    body = c.getresponse().read().decode(errors="replace")
    m = re.search(r"fgtauth\?([0-9a-f]+)", body)
    return m.group(1) if m else None


def attempt(scheme, port, path, magic):
    if scheme == "https":
        ctx = ssl._create_unverified_context()
        conn = http.client.HTTPSConnection(HOST, port, context=ctx, timeout=20)
    else:
        conn = http.client.HTTPConnection(HOST, port, timeout=20)
    data = urllib.parse.urlencode(
        {"username": USER, "password": PASS, "magic": magic, "4Tredir": REDIR}
    )
    conn.request(
        "POST",
        path,
        body=data,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "Mozilla/5.0",
            "Accept": "text/html,application/xhtml+xml",
        },
    )
    r = conn.getresponse()
    body = r.read()
    return r.status, r.reason, len(body), body[:400]


def main():
    if not USER or not PASS:
        print("Falta usuario o contraseña.")
        return 2
    magic = get_magic()
    print(f"magic obtenido: {magic}")
    if not magic:
        print("No se pudo obtener el magic (el interceptor no devolvió el redirect).")
        return 1

    targets = [
        ("http", HTTP_PORT, "/"),
        ("http", HTTP_PORT, f"/fgtauth?{magic}"),
        ("https", HTTPS_PORT, "/"),
        ("https", HTTPS_PORT, f"/fgtauth?{magic}"),
    ]
    ok = False
    for scheme, port, path in targets:
        try:
            status, reason, ln, body = attempt(scheme, port, path, magic)
            print(f"[{scheme}:{port}{path}] -> {status} {reason} ({ln} bytes)")
            flat = body.decode(errors="replace")
            for kw in ("keepalive", "success", "logged", "authentication", "Redir", "error"):
                if kw.lower() in flat.lower():
                    print(f"    ...{kw}...")
            if status == 200 and ln > 200:
                ok = True
                print(flat[:400])
        except Exception as e:
            print(f"[{scheme}:{port}{path}] -> ERROR {type(e).__name__}: {e}")
    print("RESULTADO:", "posible éxito (ver arriba)" if ok else "sin respuesta del portal")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
