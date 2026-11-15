# Единый образ Tomato: собранный frontend раздаёт сам backend (REST /api, WebSocket /ws и статика на одном порту).
# Так в задеплоенной версии нет «висящего» прокси на несуществующий backend.
#
#   docker build -t tomato .
#   docker run -p 80:3000 -v tomato-data:/data tomato
#
# Базовый образ можно переопределить (например, зеркалом из внутреннего registry):
#   docker build --build-arg NODE_IMAGE=<registry>/node:22-bookworm-slim .
# Нужен Node >= 22.13 (встроенный node:sqlite).
ARG NODE_IMAGE=node:22-bookworm-slim

# ---------- 1. сборка frontend ----------
FROM ${NODE_IMAGE} AS web
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ---------- 2. backend + статика ----------
FROM ${NODE_IMAGE} AS app
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    TOMATO_DB=/data/tomato.db \
    TOMATO_STATIC_DIR=/app/public
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/src ./src
# описания маршрутов для Swagger (/api/docs) берутся из backend/docs/API.md
COPY backend/docs ./docs
COPY --from=web /src/frontend/dist /app/public
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
