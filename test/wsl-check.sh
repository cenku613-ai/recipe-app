#!/bin/bash
# Docker 容器健康檢查腳本（在 WSL 內執行）
echo "=== Docker daemon ==="
docker info --format 'Server={{.ServerVersion}}' 2>&1 | head -1
echo "=== 容器狀態 ==="
docker ps -a --filter name=recipebox --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo "=== 容器內 HTTP（127.0.0.1:3777）==="
docker exec recipebox wget -qO- --timeout=8 http://127.0.0.1:3777/ 2>&1 | head -c 120
echo ""
echo "=== 本機 WSL HTTP（localhost:3888）==="
wget -qO- --timeout=8 http://localhost:3888/ 2>&1 | head -c 120
echo ""
echo "=== 端口監聽 ==="
ss -ltnp 2>/dev/null | grep -E '3888|3777' || netstat -ltn | grep -E '3888|3777'
echo "=== 重啟次數 ==="
docker inspect recipebox --format 'RestartCount={{.RestartCount}} Status={{.State.Status}} ExitCode={{.State.ExitCode}}'
