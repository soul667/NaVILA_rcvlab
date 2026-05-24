# NaVILA Remote Inference API

将 NaVILA 推理部署在 GPU 服务器上，真机通过 HTTP API 调用。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│              GPU 服务器 (本仓库 /home/wyc/NaVILA)             │
│                                                              │
│   FastAPI Server (:8000)                                     │
│   - POST /infer    接收 8 帧 JPEG + instruction → action     │
│   - GET  /health   健康检查                                  │
│   - GET  /         可视化 Dashboard                          │
│   - GET  /history  最近 50 次推理记录                         │
└──────────────────────────────────────────────────────────────┘
                         ▲ HTTP (局域网)
                         │
┌──────────────────────────────────────────────────────────────┐
│              真机 Jetson (/home/wyc/NaVILA_rcvlab)            │
│                                                              │
│   navila_core (HTTP client, 2Hz)                             │
│   - 缓存 8 帧 → base64 JPEG → POST /infer                   │
│   - 接收 action → 发布 /navila/action                        │
│                                                              │
│   oli_bridge (不变)                                          │
│   - /navila/action → WebSocket 30Hz → OLI Robot             │
└──────────────────────────────────────────────────────────────┘
```

## 服务器端启动

```bash
cd /home/wyc/NaVILA
./server/run_server.sh --gpu 0
```

或手动：

```bash
cd /home/wyc/NaVILA
conda activate navila-eval
CUDA_VISIBLE_DEVICES=0 PYTHONPATH=/home/wyc/NaVILA uvicorn server.app:app --host 0.0.0.0 --port 8000 --workers 1
```

启动参数：

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--gpu` | 使用哪张 GPU | 0 |
| `--port` | 监听端口 | 8000 |
| `--host` | 监听地址 | 0.0.0.0 |
| `--8bit` | 8-bit 量化 | 关 |
| `--4bit` | 4-bit 量化 | 关 |

环境变量：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `NAVILA_MODEL_PATH` | 模型路径 | `./checkpoints/navila-llama3-8b-8f` |
| `NAVILA_LOAD_8BIT` | 设为 "1" 启用 8-bit | 0 |
| `NAVILA_LOAD_4BIT` | 设为 "1" 启用 4-bit | 0 |

## 可视化 Dashboard

浏览器打开 `http://<服务器IP>:8000/`

显示内容：
- GPU 名称、VRAM 占用
- 推理总次数、平均延迟
- 每次推理的最后一帧图像、action 结果、instruction、延迟

页面每 2 秒自动刷新。

## 真机端配置

编辑 `deploy/navila_core/config/navila_params.yaml`：

```yaml
navila_core:
  ros__parameters:
    server_url: "http://<服务器IP>:8000"  # ← 改成实际 IP
    num_frames: 8
    inference_rate: 2.0
    instruction: "navigate to the goal"
    jpeg_quality: 85
    request_timeout: 10.0
```

然后正常启动：

```bash
cd deploy
docker compose -f docker-compose.oli.yml up -d
```

## API 接口说明

### POST /infer

请求体：

```json
{
  "frames": ["<base64 JPEG>", ...],
  "instruction": "navigate to the kitchen"
}
```

响应：

```json
{
  "raw_output": "The next action is move forward 25 cm.",
  "action": "move_forward",
  "distance_cm": 25,
  "degree": 0,
  "latency_ms": 1449.1
}
```

action 取值：`stop` / `move_forward` / `turn_left` / `turn_right`

### GET /health

```json
{
  "status": "ok",
  "model_loaded": true,
  "model_path": "/home/wyc/NaVILA/checkpoints/navila-llama3-8b-8f",
  "num_video_frames": 8,
  "gpu_name": "NVIDIA RTX A6000",
  "gpu_memory_used_mb": 15234,
  "gpu_memory_total_mb": 49140
}
```

## 文件结构

```
server/
├── app.py           # FastAPI 服务 + Dashboard HTML
├── inference.py     # 模型推理引擎（从 navila_trainer.py 提取）
├── run_server.sh    # 启动脚本
├── static/          # 静态资源（预留）
└── test_api.py      # 测试脚本
```

## 性能参考

- 模型加载：~5s
- 单次推理延迟：~1.1-1.5s（A6000, fp16, 8帧）
- 加上局域网传输：~1.5-2s 端到端
- 2Hz 推理频率完全满足
