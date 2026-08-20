# ============================================================
# MercAldas — servidor Advantage Database Server (ADS) para Linux
# ============================================================
# ⚠️ REQUIERE el instalador oficial. Colócalo en:
#       db/ads/installers/adslinux-11.10.0.24.tar.gz
#
# El producto fue descontinuado por SAP (dic-2022) y el devzone está
# cerrado; el instalador hay que conseguirlo del proveedor del sistema
# VISADS, de la máquina Windows original, o de quien tenga el producto.
#
# NOTA: el contenido interno del tarball no está verificado (no se pudo
# descargar de ninguna fuente pública). El bloque de instalación abajo
# puede requerir ajustarse a lo que traiga el archivo real.
# ============================================================

FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# El daemon de ADS en Debian puede requerir libnss-nis (fuente:
# docs.xsharp.it — "The Advantage Database Server on Linux").
RUN apt-get update && apt-get install -y --no-install-recommends \
        libnss-nis \
        libaio1 \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/ads

# --- Instalador -------------------------------------------------
COPY installers/adslinux-11.10.0.24.tar.gz /tmp/adslinux.tar.gz
RUN tar xzf /tmp/adslinux.tar.gz -C /opt/ads \
    && rm -f /tmp/adslinux.tar.gz

# El tarball de ADS Linux suele traer un install.sh INTERACTIVO (pide el
# directorio de instalación). Ajusta según lo que traiga el archivo real:
#   RUN printf '/opt/ads\n' | ./install.sh
# O si trae binarios listos, solo hazlos ejecutables:
#   RUN chmod +x /opt/ads/bin/ads
# ----------------------------------------------------------------

# Configuración del servidor (ver db/ads/ads.conf)
COPY ads.conf /etc/ads.conf

EXPOSE 6262 2000

# El daemon se inicia con el binario `ads`; ajusta la ruta real
# (o usa el script /etc/init.d/ads que cree el instalador).
CMD ["/opt/ads/bin/ads", "start", "-fg"]
