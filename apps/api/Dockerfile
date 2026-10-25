# syntax=docker/dockerfile:1
# The API and its workers in one process (docs/DEPLOY.md). From the repository root:
#   docker build -f apps/api/Dockerfile -t facture-impec-api .
# Internal packages ship TypeScript source run through tsx (CLAUDE.md): there is no build step.
FROM node:22.23.3-bookworm-slim
ENV CI=true
# The ingest worker reads PDFs (pdftotext, pdftoppm) and scans (tesseract, French): src/reading.ts.
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-fra \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --prod --filter "@fi/api..." && pnpm store prune
# The runner's database volume (deploy/runner/): mounted here, it takes this folder's owner.
RUN mkdir -p /data && chown node:node /data
# Inside a container the API listens on every interface; the proxy in front terminates TLS.
ENV NODE_ENV=production API_HOST=0.0.0.0 API_PORT=4000
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["apps/api/node_modules/.bin/tsx", "apps/api/src/server.ts"]
