#!/bin/sh
# RecipeBox 容器啟動腳本
set -e

# 首次啟動寫入示範食譜（資料庫已有內容則自動略過）
if [ "${SEED_ON_START:-1}" = "1" ]; then
  echo "[entrypoint] 檢查示範資料..."
  node --disable-warning=ExperimentalWarning seed.js || echo "[entrypoint] seed 略過（已有資料或失敗不影響啟動）"
fi

echo "[entrypoint] 啟動 RecipeBox，監聽 ${HOST:-0.0.0.0}:${PORT:-3777}"
exec node --disable-warning=ExperimentalWarning server.js
