# ============================================================
# OpenADS — servidor compat con Advantage (ADS) sobre Linux
# ============================================================
# Reemplaza al instalador de SAP (descontinuado y no disponible).
# Lee/escribe .adt/.adm/.adi nativos de Advantage de forma byte-compatible.
#
# Build:  docker compose build
# Run:    docker compose up -d
# ============================================================

# ---------- etapa 1: compilación ----------
FROM debian:bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
        cmake g++ make ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Flags de build. TLS y backends SQL apagados: no los necesitamos para ADT.
ARG OPENADS_WITH_TLS=OFF
ARG OPENADS_WITH_SQLITE=OFF
ARG OPENADS_WITH_HTTP=ON

COPY src /src
RUN cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release \
        -DOPENADS_WARNINGS_AS_ERRORS=OFF \
        -DOPENADS_BUILD_TESTS=OFF \
        -DOPENADS_WITH_TLS=${OPENADS_WITH_TLS} \
        -DOPENADS_WITH_SQLITE=${OPENADS_WITH_SQLITE} \
        -DOPENADS_WITH_HTTP=${OPENADS_WITH_HTTP} \
    && cmake --build /build -j"$(nproc)"

# ---------- etapa 2: runtime ----------
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        libstdc++6 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/tools/serverd/openads_serverd   /opt/openads/openads_serverd
COPY --from=builder /build/tools/adsbackup/adsbackup       /opt/openads/adsbackup
COPY --from=builder /build/tools/import_dd/openads_import_dd /opt/openads/openads_import_dd
COPY --from=builder /build/tools/adi_inspect/adi_inspect   /opt/openads/adi_inspect
COPY --from=builder /build/src/libopenace64.so             /opt/openads/libopenace64.so

# Directorio de datos (tables .adt/.dbf). Se monta como volumen.
VOLUME /data
# 6262 = puerto wire de ADS (compatibilidad); 8080 = consola Studio (web)
EXPOSE 6262 8080

# El servidor rechaza bind anónimo fuera de loopback: la auth va por argumentos
# (no existe variable de entorno). Cambiar en producción.
ENV OPENADS_ERROR_LOG_PATH=/var/log/openads

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/opt/openads/openads_serverd", "--version"]

ENTRYPOINT ["/opt/openads/openads_serverd"]
CMD ["--data", "/data", "--host", "0.0.0.0", "--port", "6262", \
     "--http_port", "8080", \
     "--auth_user", "dsi:dsi", "--http_user", "dsi:dsi"]
