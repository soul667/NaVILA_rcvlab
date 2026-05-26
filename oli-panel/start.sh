#!/bin/bash
# OLI Robot Control Panel - 启动脚本
# 启动前端 dev server (port 3001) 和相机 API server (port 3002)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
export PATH="/home/wyc/node-v20.19.0-linux-x64/bin:/home/guest/micromamba/bin:$PATH"

echo "=== OLI Robot Control Panel ==="
echo ""

# 杀掉旧进程
pkill -f "server.cjs" 2>/dev/null
pkill -f "vite.*3001" 2>/dev/null
sleep 1

# 启动 Camera API Server (port 3002)
echo "[1/2] Starting Camera API server on :3002..."
setsid node "$SCRIPT_DIR/server.cjs" > /tmp/camera-api.log 2>&1 &
CAMERA_PID=$!
sleep 1

# 启动 Vite Dev Server (port 3001)
echo "[2/2] Starting frontend on :3001..."
cd "$SCRIPT_DIR"
setsid npx vite --host 0.0.0.0 --port 3001 > /tmp/vite-dev.log 2>&1 &
VITE_PID=$!
sleep 2

# 验证
echo ""
echo "=== 服务状态 ==="
if ss -tlnp | grep -q ":3001"; then
  echo "  Frontend:   http://10.192.1.3:3001/  [OK]"
else
  echo "  Frontend:   FAILED (check /tmp/vite-dev.log)"
fi

if ss -tlnp | grep -q ":3002"; then
  echo "  Camera API: http://localhost:3002/    [OK]"
else
  echo "  Camera API: FAILED (check /tmp/camera-api.log)"
fi

echo ""
echo "=== 使用说明 ==="
echo "  1. 浏览器打开 http://10.192.1.3:3001/"
echo "  2. 面板会自动连接机器人 WebSocket (ws://10.192.1.2:5000)"
echo "  3. 如需停止: ./stop.sh 或 pkill -f 'server.cjs|vite.*3001'"
echo ""
echo "日志文件:"
echo "  Frontend:   /tmp/vite-dev.log"
echo "  Camera API: /tmp/camera-api.log"
