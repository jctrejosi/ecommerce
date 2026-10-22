# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS build
WORKDIR /src

COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /src/target/release/ingest /usr/local/bin/ingest
COPY --from=build /src/target/release/worker /usr/local/bin/worker

ENV RUST_LOG=tracking=info,ingest=info,worker=info
EXPOSE 8090

# El servicio a ejecutar se pasa como argumento: `ingest` (por defecto) o `worker`.
CMD ["ingest"]
