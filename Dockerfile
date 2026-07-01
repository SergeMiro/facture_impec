# Backend Facture Impec — build multi-étapes.
# Contexte de build = racine du dépôt (workspace Cargo).

FROM rust:1-slim AS builder
WORKDIR /app
COPY . .
RUN cargo build --release -p facture-backend

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m app
COPY --from=builder /app/target/release/facture-backend /usr/local/bin/facture-backend
USER app

# Configuration par variables d'environnement (cf. docs/DEPLOIEMENT.md).
ENV BIND_ADDR=0.0.0.0:8080
EXPOSE 8080
CMD ["facture-backend"]
