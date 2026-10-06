# ---- 安裝生產相依（伺服器執行時需要字幕套件）----
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ---- 執行環境 ----
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3777 \
    HOST=0.0.0.0 \
    SEED_ON_START=1

# 只帶入執行所需的東西（public/vendor 已含 jsPDF / html2canvas）
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js seed.js docker-entrypoint.sh ./
COPY public ./public

RUN chmod +x docker-entrypoint.sh \
 && mkdir -p data \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app

USER app
EXPOSE 3777
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3777)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./docker-entrypoint.sh"]
