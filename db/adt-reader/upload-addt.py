#!/usr/bin/env python3
"""Sube db/ADDT a la máquina Windows por SMB con LOG DE PROGRESO.

- Muestra por archivo: MB enviados / total, %, velocidad y ETA.
- Al final de cada archivo: resumen y acumulado general.
- RESUMIBLE: salta los archivos que ya existen en destino con el mismo
  tamaño (así un corte no obliga a reenviar VENTAS de 14 GB).
- Credenciales por variables de entorno RDP_USER / RDP_PWD (no se
  guardan en el script).

Uso:
    RDP_USER=Desarrollo3 RDP_PWD='...' python3 db/adt-reader/upload-addt.py
    # opcional: --share Users --remotedir /Desarrollo3/ADDT --localdir db/ADDT
"""
import argparse
import logging
import os
import sys
import time
from datetime import timedelta

from smb.SMBConnection import SMBConnection

LOG_FORMAT = "%(asctime)s %(message)s"


class ProgressFile:
    """File-like que cuenta bytes leídos y loguea progreso (pysmb usa read())."""

    def __init__(self, path: str, size: int, label: str, log: logging.Logger):
        self._fh = open(path, "rb")
        self.size = size
        self.done = 0
        self.t0 = time.time()
        self.last_log = 0.0
        self.label = label
        self.log = log

    def read(self, n: int = -1):
        chunk = 65536 if n is None or n < 0 else max(1, n)
        data = self._fh.read(chunk)
        self.done += len(data)
        now = time.time()
        if now - self.last_log >= 2.0:
            self.last_log = now
            self._log(now)
        return data

    def close(self):
        try:
            self._fh.close()
        except Exception:
            pass

    def _log(self, now: float):
        pct = (self.done / self.size * 100) if self.size else 100.0
        speed = self.done / (now - self.t0) / 1024 / 1024 if now > self.t0 else 0.0
        rem = self.size - self.done
        eta = (rem / (speed * 1024 * 1024)) if speed > 0 else 0
        self.log.info(
            "  %s: %6.1f / %6.1f MB (%5.1f%%) | %6.1f MB/s | ETA %s",
            self.label, self.done / 1048576, self.size / 1048576,
            pct, speed, str(timedelta(seconds=int(eta))),
        )


def remote_size(conn, share: str, path: str):
    try:
        return conn.getAttributes(share, path).file_size
    except Exception:
        return None


def ensure_dir(conn, share: str, remote_dir: str, log: logging.Logger):
    """Crea el directorio remoto (y padres) si no existe."""
    parts = [p for p in remote_dir.replace("\\", "/").split("/") if p]
    current = ""
    for p in parts:
        current = f"{current}/{p}"
        try:
            conn.createDirectory(share, current)
        except Exception:
            pass  # ya existe
    log.info("Directorio remoto listo: %s:%s", share, remote_dir)


def main() -> int:
    ap = argparse.ArgumentParser(description="Sube ADDT por SMB con progreso")
    ap.add_argument("--host", default="89.117.149.145")
    ap.add_argument("--port", type=int, default=445)
    ap.add_argument("--share", default="Users")
    ap.add_argument("--remotedir", default="/Desarrollo3/ADDT")
    ap.add_argument("--localdir", default="db/ADDT")
    ap.add_argument("--logfile", default="db/adt-reader/upload-addt.log")
    args = ap.parse_args()

    user = os.environ.get("RDP_USER", "")
    pwd = os.environ.get("RDP_PWD", "")
    if not user or not pwd:
        print("Faltan RDP_USER / RDP_PWD")
        return 2

    logging.basicConfig(
        level=logging.INFO, format=LOG_FORMAT,
        handlers=[
            logging.StreamHandler(sys.stdout),
            logging.FileHandler(args.logfile, encoding="utf-8"),
        ],
    )
    log = logging.getLogger("upload")

    files = sorted(
        os.path.join(args.localdir, f)
        for f in os.listdir(args.localdir)
        if os.path.isfile(os.path.join(args.localdir, f))
    )
    if not files:
        log.error("No hay archivos en %s", args.localdir)
        return 2
    total_bytes = sum(os.path.getsize(f) for f in files)
    log.info("Subiendo %d archivos / %.2f GB desde %s -> %s:%s",
             len(files), total_bytes / 1073741824, args.localdir,
             args.share, args.remotedir)
    log.info("Destino real: C:\\Users\\Desarrollo3\\ADDT (share Users; C$ sin permiso)")

    conn = SMBConnection(user, pwd, "linuxhost", "winhost",
                         use_ntlm_v2=True, is_direct_tcp=True)
    if not conn.connect(args.host, args.port, timeout=25):
        log.error("No se pudo conectar a %s", args.host)
        return 1
    ensure_dir(conn, args.share, args.remotedir, log)

    t_start = time.time()
    done_total = 0
    for f in files:
        name = os.path.basename(f)
        size = os.path.getsize(f)
        remote = f"{args.remotedir.rstrip('/')}/{name}"
        prev = remote_size(conn, args.share, remote)
        if prev is not None and prev == size:
            log.info("✓ %s ya está en destino (%d MB), se omite", name, size // 1048576)
            done_total += size
            continue

        log.info(">> %s (%d MB)", name, size // 1048576)
        pf = ProgressFile(f, size, name, log)
        try:
            ultimo_error = None
            for intento in range(1, 6):
                try:
                    conn.storeFile(args.share, remote, pf, timeout=60 * 30)
                    break
                except Exception as exc:
                    ultimo_error = exc
                    log.warning("  %s intento %d/5 falló: %s — reintentando...", name, intento, str(exc)[:100])
                    pf.close()
                    pf = ProgressFile(f, size, name, log)
                    time.sleep(5 * intento)
            else:
                raise ultimo_error or RuntimeError("falló la subida")
            log.info("✓ %s subido (%d MB) | acumulado %.2f / %.2f GB",
                     name, size // 1048576,
                     (done_total + size) / 1073741824, total_bytes / 1073741824)
        except Exception as exc:
            log.error("✗ %s FALLÓ: %s (se puede reintentar: salta los ya subidos)", name, exc)
            conn.close()
            return 1
        finally:
            pf.close()
        done_total += size

    elapsed = time.time() - t_start
    log.info("== Subida completa: %.2f GB en %s (%.1f MB/s promedio) ==",
             total_bytes / 1073741824, str(timedelta(seconds=int(elapsed))),
             total_bytes / 1048576 / elapsed if elapsed else 0)
    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
