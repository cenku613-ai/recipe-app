#!/bin/bash
# RecipeBox Docker 一鍵部署驗證（在 WSL 內執行）
set -u
cd /mnt/d/workspace/recipe-app || exit 1

echo "=== 1. 啟動 Docker daemon（若未執行）==="
if ! docker info >/dev/null 2>&1; then
  nohup dockerd >/tmp/dockerd.log 2>&1 &
  for i in $(seq 1 30); do
    docker info >/dev/null 2>&1 && break
    sleep 1
  done
fi
docker info --format 'Docker server {{.ServerVersion}} 啟動 ✅' || { echo 'Docker 啟動失敗'; exit 1; }

echo ""
echo "=== 2. docker compose 建置＋啟動 ==="
export PORT=3888
docker compose up -d --build 2>&1 | tail -5

echo ""
echo "=== 3. 容器狀態 ==="
docker ps -a --filter name=recipebox --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker inspect recipebox --format 'RestartCount={{.RestartCount}} Status={{.State.Status}}'

echo ""
echo "=== 4. 容器啟動紀錄 ==="
docker logs recipebox 2>&1 | tail -8

echo ""
echo "=== 5. HTTP 驗證 ==="
CODE=$(wget -qO- --timeout=10 -S http://localhost:3888/ 2>&1 | grep -o 'HTTP/[0-9.]* [0-9]*' | head -1)
echo "首頁: $CODE"
echo "靜態 JS: $(wget -qO- --timeout=10 -S http://localhost:3888/js/form.js 2>&1 | grep -o 'HTTP/[0-9.]* [0-9]*' | head -1)"
echo "未授權 API: $(wget -qO- --timeout=10 -S http://localhost:3888/api/auth/me 2>&1 | grep -o 'HTTP/[0-9.]* [0-9]*' | head -1)（預期 401）"

echo ""
echo "=== 6. 資料持久化（對應 ./data）==="
docker exec recipebox sh -c 'ls -la /app/data/ | head -5'

echo ""
echo "=== 7. 註冊帳號（驗證 API + 資料庫寫入）==="
wget -qO- --timeout=10 --post-data='{"email":"docker-test@example.com","password":"password123","name":"Docker測試"}' \
  --header='Content-Type: application/json' \
  http://localhost:3888/api/auth/register 2>&1 | head -c 200
echo ""
