#!/bin/bash
# 停止 OLI Control Panel 所有服务

echo "Stopping OLI Control Panel..."
pkill -f "server.cjs" 2>/dev/null
pkill -f "vite.*3001" 2>/dev/null
echo "Done."
