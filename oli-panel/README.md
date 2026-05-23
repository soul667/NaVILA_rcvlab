# OLI Robot Control Panel

基于 React + Ant Design 的 OLI 人形机器人 Web 控制面板。

## 环境要求

- Node.js（已通过 micromamba 安装在 `/home/guest/micromamba/bin/`）

## 快速启动

```bash
# 1. 进入项目目录
cd /home/guest/code/NaVILA_rcvlab/oli-panel

# 2. 一键启动（前端 + 相机API）
./start.sh
```

启动后访问：**http://10.192.1.3:3001/**

## 停止服务

```bash
./stop.sh
```

## 手动启动（如果 start.sh 不好使）

```bash
export PATH="/home/guest/micromamba/bin:$PATH"
cd /home/guest/code/NaVILA_rcvlab/oli-panel

# 启动相机 API 后端 (port 3002)
node server.cjs &

# 启动前端 dev server (port 3001)
npx vite --host 0.0.0.0 --port 3001
```

## 如果提示找不到 npm/node

```bash
# 手动加 PATH
export PATH="/home/guest/micromamba/bin:$PATH"

# 或者写入 bashrc 永久生效
echo 'export PATH="/home/guest/micromamba/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## 首次安装依赖（仅第一次）

```bash
export PATH="/home/guest/micromamba/bin:$PATH"
cd /home/guest/code/NaVILA_rcvlab/oli-panel
npm install
```

## 功能说明

| Tab | 功能 |
|-----|------|
| 状态监控 | IMU 姿态、硬件诊断、动作库状态、关节数据 |
| 模式控制 | 零力矩/阻尼/站立/行走/坐下/躺下/动作库/灯效 |
| 行走控制 | 三轴速度滑块 + 键盘 WASD 控制，30Hz 发送 |
| 动作/舞蹈 | 获取并执行动作库动作和舞蹈 |
| 相机 | 启动/停止 RealSense 相机节点 |
| 推理服务 | 云端 NaVILA 推理控制：设置指令、暂停/恢复 |
| 消息日志 | 机器人 WebSocket 推送消息 |

## 网络配置

| 服务 | 地址 |
|------|------|
| 前端面板 | http://10.192.1.3:3001 |
| 相机 API | http://localhost:3002 |
| 机器人 WebSocket | ws://10.192.1.2:5000 |
| 推理服务器 | http://10.16.117.238:8000 |

## 键盘快捷键（行走控制 Tab）

- `W` / `↑` — 前进
- `S` / `↓` — 后退
- `A` / `←` — 左转
- `D` / `→` — 右转
- `Q` — 左横移
- `E` — 右横移
- `空格` — 急停
