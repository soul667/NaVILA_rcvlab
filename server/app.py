"""NaVILA Inference API Server.

Provides HTTP API for remote NaVILA inference + web visualization dashboard.
Designed to run on a GPU server while the robot calls the API over LAN.
"""

import base64
import io
import sys
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from PIL import Image

DEFAULT_MODEL_PATH = str(Path(__file__).resolve().parent.parent / "checkpoints" / "navila-llama3-8b-8f")
MAX_HISTORY = 50
SAVE_DIR = Path(__file__).resolve().parent.parent / "inference_logs"

engine = None
inference_history = deque(maxlen=MAX_HISTORY)
all_history = []  # unbounded, persisted to disk
current_instruction = "navigate to the goal"
inference_paused = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global engine
    import os

    model_path = os.environ.get("NAVILA_MODEL_PATH", DEFAULT_MODEL_PATH)
    load_8bit = os.environ.get("NAVILA_LOAD_8BIT", "0") == "1"
    load_4bit = os.environ.get("NAVILA_LOAD_4BIT", "0") == "1"

    print(f"[NaVILA Server] Loading model from: {model_path}")
    print(f"[NaVILA Server] Quantization: 8bit={load_8bit}, 4bit={load_4bit}")

    project_root = str(Path(__file__).resolve().parent.parent)
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    try:
        from server.inference import NaVILAInference
        engine = NaVILAInference(model_path, load_8bit=load_8bit, load_4bit=load_4bit)
        print(f"[NaVILA Server] Model loaded. num_video_frames={engine.num_video_frames}")
    except Exception as e:
        print(f"[NaVILA Server] ERROR: Failed to load model: {e}")
        print(f"[NaVILA Server] Server will start but /infer will return 503")

    _load_history_from_disk()

    yield
    engine = None


app = FastAPI(
    title="NaVILA Inference Server",
    description="Remote inference API for NaVILA navigation VLA model",
    version="1.0.0",
    lifespan=lifespan,
)

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(FRONTEND_DIST / "assets")), name="assets")


class InferRequest(BaseModel):
    frames: List[str]
    instruction: str = ""
    num_frames: Optional[int] = None


class InferResponse(BaseModel):
    raw_output: str
    action: str
    distance_cm: int
    degree: int
    latency_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_path: str
    num_video_frames: int
    gpu_name: str
    gpu_memory_used_gb: float
    gpu_memory_total_gb: float


class InstructionRequest(BaseModel):
    instruction: str


@app.get("/health", response_model=HealthResponse)
async def health():
    gpu_name = "N/A"
    gpu_mem_used_gb = 0.0
    gpu_mem_total_gb = 0.0

    if engine and engine.is_loaded:
        try:
            import torch
            device = next(engine.model.parameters()).device
            gpu_name = torch.cuda.get_device_name(device)
            gpu_mem_used_gb = round(torch.cuda.memory_allocated(device) / (1024 ** 3), 2)
            gpu_mem_total_gb = round(torch.cuda.get_device_properties(device).total_memory / (1024 ** 3), 2)
        except Exception:
            pass

    return HealthResponse(
        status="ok" if engine and engine.is_loaded else "loading",
        model_loaded=engine.is_loaded if engine else False,
        model_path=engine.model_path if engine else "",
        num_video_frames=engine.num_video_frames if engine else 0,
        gpu_name=gpu_name,
        gpu_memory_used_gb=gpu_mem_used_gb,
        gpu_memory_total_gb=gpu_mem_total_gb,
    )


@app.get("/state")
async def get_state():
    return {"instruction": current_instruction, "paused": inference_paused}


@app.post("/set_instruction")
async def set_instruction(req: InstructionRequest):
    global current_instruction
    current_instruction = req.instruction
    return {"instruction": current_instruction}


@app.post("/pause")
async def pause():
    global inference_paused
    inference_paused = True
    return {"paused": True}


@app.post("/resume")
async def resume():
    global inference_paused
    inference_paused = False
    return {"paused": False}


@app.post("/infer", response_model=InferResponse)
async def infer(request: InferRequest):
    if inference_paused:
        raise HTTPException(status_code=503, detail="Inference paused")
    if engine is None or not engine.is_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded yet")
    if not request.frames:
        raise HTTPException(status_code=400, detail="No frames provided")

    instruction = current_instruction or request.instruction
    if not instruction:
        raise HTTPException(status_code=400, detail="No instruction provided")

    pil_frames = []
    for i, b64_frame in enumerate(request.frames):
        try:
            img_bytes = base64.b64decode(b64_frame)
            img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            pil_frames.append(img)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to decode frame {i}: {e}")

    try:
        result = engine.infer(pil_frames, instruction)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Inference failed: {e}")

    inference_history.append({
        "timestamp": time.time(),
        "instruction": instruction,
        "num_frames": len(pil_frames),
        "result": result,
        "frames_b64": request.frames,
    })
    all_history.append({
        "timestamp": time.time(),
        "instruction": instruction,
        "num_frames": len(pil_frames),
        "result": result,
        "frames_b64": request.frames,
    })

    _save_inference_log(request.frames, instruction, result)

    return InferResponse(
        raw_output=result["raw_output"],
        action=result["action"],
        distance_cm=result["distance_cm"],
        degree=result["degree"],
        latency_ms=result["latency_ms"],
    )


@app.get("/history")
async def get_history():
    return list(inference_history)


@app.get("/history_all")
async def get_history_all(session_id: Optional[int] = None):
    sessions = _group_sessions(all_history)
    if session_id is not None:
        if session_id < 0 or session_id >= len(sessions):
            raise HTTPException(status_code=404, detail="Session not found")
        return {"items": sessions[session_id]["items"]}
    summary = []
    for i, s in enumerate(sessions):
        summary.append({
            "id": i,
            "start_time": s["items"][0]["timestamp"],
            "end_time": s["items"][-1]["timestamp"],
            "instruction": s["items"][0]["instruction"],
            "count": len(s["items"]),
        })
    summary.reverse()
    return {"sessions": summary, "total": len(sessions)}


def _group_sessions(history, gap_threshold=10.0):
    if not history:
        return []
    sessions = []
    current_session = [history[0]]
    for i in range(1, len(history)):
        if history[i]["timestamp"] - history[i-1]["timestamp"] > gap_threshold:
            sessions.append({"items": current_session})
            current_session = [history[i]]
        else:
            current_session.append(history[i])
    sessions.append({"items": current_session})
    return sessions


def _save_inference_log(frames_b64: list, instruction: str, result: dict):
    import json
    from datetime import datetime

    ts = datetime.now().strftime("%Y%m%d_%H%M%S_%f")[:-3]
    log_dir = SAVE_DIR / ts
    log_dir.mkdir(parents=True, exist_ok=True)

    for i, b64 in enumerate(frames_b64):
        img_bytes = base64.b64decode(b64)
        (log_dir / f"frame_{i:02d}.jpg").write_bytes(img_bytes)

    meta = {
        "timestamp": ts,
        "instruction": instruction,
        "num_frames": len(frames_b64),
        "result": result,
    }
    (log_dir / "meta.json").write_text(json.dumps(meta, indent=2))


def _load_history_from_disk():
    import json
    from datetime import datetime

    if not SAVE_DIR.exists():
        return

    dirs = sorted(SAVE_DIR.iterdir())
    print(f"[NaVILA Server] Loading {len(dirs)} inference logs from disk...")

    for d in dirs:
        meta_path = d / "meta.json"
        if not meta_path.exists():
            continue
        try:
            meta = json.loads(meta_path.read_text())
            ts_str = meta["timestamp"]
            ts_float = datetime.strptime(ts_str, "%Y%m%d_%H%M%S_%f").timestamp()

            frames_b64 = []
            for frame_file in sorted(d.glob("frame_*.jpg")):
                frames_b64.append(base64.b64encode(frame_file.read_bytes()).decode("ascii"))

            entry = {
                "timestamp": ts_float,
                "instruction": meta["instruction"],
                "num_frames": meta["num_frames"],
                "result": meta["result"],
                "frames_b64": frames_b64,
            }
            all_history.append(entry)
        except Exception as e:
            print(f"[NaVILA Server] Skip {d.name}: {e}")

    print(f"[NaVILA Server] Loaded {len(all_history)} entries into all_history")


@app.get("/", response_class=HTMLResponse)
async def dashboard():
    index_path = FRONTEND_DIST / "index.html"
    if index_path.exists():
        return index_path.read_text()
    return "<h1>Frontend not built. Run: cd server/frontend && npm run build</h1>"


@app.get("/live", response_class=HTMLResponse)
async def live_view():
    index_path = FRONTEND_DIST / "index.html"
    if index_path.exists():
        return index_path.read_text()
    return "<h1>Frontend not built.</h1>"
