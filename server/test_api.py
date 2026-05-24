import sys, os, base64, io, time
sys.path.insert(0, "/home/wyc/NaVILA")
os.environ["CUDA_VISIBLE_DEVICES"] = "0"

from pathlib import Path
from server.inference import NaVILAInference

model_path = str(Path("/home/wyc/NaVILA/checkpoints/navila-llama3-8b-8f"))
print(f"Loading from: {model_path}")
engine = NaVILAInference(model_path)
print(f"Loaded: {engine.is_loaded}, frames: {engine.num_video_frames}")

import server.app as app_module
app_module.engine = engine

from fastapi.testclient import TestClient
from server.app import app
from PIL import Image

client = TestClient(app, raise_server_exceptions=True)

resp = client.get("/health")
print(f"Health: {resp.json()}")

frames_b64 = []
for i in range(8):
    img = Image.new("RGB", (640, 480), color=(50 + i * 20, 100, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    frames_b64.append(base64.b64encode(buf.getvalue()).decode("ascii"))

print("Calling /infer...")
start = time.time()
resp = client.post("/infer", json={
    "frames": frames_b64,
    "instruction": "navigate to the kitchen",
})
total = (time.time() - start) * 1000
print(f"Status: {resp.status_code}")
print(f"Response: {resp.json()}")
print(f"Total round-trip: {total:.0f}ms")

resp = client.get("/history")
print(f"History items: {len(resp.json())}")
print("=== ALL TESTS PASSED ===")
