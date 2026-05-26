"""NaVILA Inference Server - FastAPI endpoint for remote VLA inference."""

import copy
import re
import time
from typing import List, Optional

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from PIL import Image as PILImage
import base64
import io

from llava.constants import IMAGE_TOKEN_INDEX
from llava.conversation import SeparatorStyle, conv_templates, auto_set_conversation_mode
from llava.mm_utils import (
    KeywordsStoppingCriteria,
    get_model_name_from_path,
    process_images,
    tokenizer_image_token,
)
from llava.model.builder import load_pretrained_model

app = FastAPI(title="NaVILA Inference Server")

# Global model state
model = None
tokenizer = None
image_processor = None
model_loaded = False
sap_controller = None


class InferenceRequest(BaseModel):
    frames: List[str]  # base64 encoded JPEG images
    instruction: str = "navigate to the goal"
    num_frames: int = 8


class InferenceResponse(BaseModel):
    command: str
    linear_velocity: float
    angular_velocity: float
    confidence: float
    reasoning: str
    goal_reached: bool
    latency_ms: float


class StatusResponse(BaseModel):
    model_loaded: bool
    device: str
    gpu_name: str
    gpu_memory_used_mb: int
    gpu_memory_total_mb: int


@app.on_event("startup")
def load_model():
    global model, tokenizer, image_processor, model_loaded

    model_path = "/models/navila-llama3-8b-8f"
    print(f"Loading model from {model_path}...")

    auto_set_conversation_mode(model_path)
    model_name = get_model_name_from_path(model_path)

    tokenizer, model, image_processor, context_len = load_pretrained_model(
        model_path,
        model_name,
        model_base=None,
        device_map="auto",
        torch_dtype=torch.float16,
    )
    model.eval()
    model_loaded = True
    print(f"Model loaded on {model.device}")


@app.get("/status", response_model=StatusResponse)
def get_status():
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "N/A"
    gpu_mem_used = torch.cuda.memory_allocated() // (1024 * 1024) if torch.cuda.is_available() else 0
    gpu_mem_total = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024) if torch.cuda.is_available() else 0
    return StatusResponse(
        model_loaded=model_loaded,
        device=str(model.device) if model else "N/A",
        gpu_name=gpu_name,
        gpu_memory_used_mb=gpu_mem_used,
        gpu_memory_total_mb=gpu_mem_total,
    )


@app.post("/infer", response_model=InferenceResponse)
def infer(req: InferenceRequest):
    global sap_controller

    if not model_loaded:
        raise HTTPException(status_code=503, detail="Model not loaded yet")

    start_time = time.time()

    # SAP: auto-start on first infer or instruction change
    if sap_controller is None or (sap_controller.active and sap_controller.current_instruction and req.instruction != sap_controller._original_instruction):
        from planner import SAPController
        sap_controller = SAPController(verify_interval=3, max_retries=3)
        initial_frame = req.frames[-1] if req.frames else None
        sap_controller.start(req.instruction, initial_frame)

    # SAP: use subtask instruction if active
    if sap_controller and sap_controller.active and not sap_controller.is_complete:
        instruction = sap_controller.current_instruction
    else:
        instruction = req.instruction

    # Decode base64 frames to PIL images
    pil_frames = []
    for frame_b64 in req.frames:
        img_bytes = base64.b64decode(frame_b64)
        pil_frames.append(PILImage.open(io.BytesIO(img_bytes)).convert("RGB"))

    # SAP: check verifier before executing
    sap_result = None
    if sap_controller and sap_controller.active and not sap_controller.is_complete:
        last_frame = req.frames[-1] if req.frames else ""
        sap_result = sap_controller.step([last_frame] if last_frame else [])

        if sap_result["action"] == "complete":
            return InferenceResponse(
                command="stop", linear_velocity=0.0, angular_velocity=0.0,
                confidence=1.0, reasoning="SAP: Task complete.",
                goal_reached=True, latency_ms=0.0,
            )
        elif sap_result["action"] == "stop":
            reason = sap_result["verify"]["reason"] if sap_result.get("verify") else "stopped"
            return InferenceResponse(
                command="stop", linear_velocity=0.0, angular_velocity=0.0,
                confidence=1.0, reasoning=f"SAP stopped: {reason}",
                goal_reached=False, latency_ms=0.0,
            )
        elif sap_result["action"] in ("next", "replan"):
            instruction = sap_controller.current_instruction

    # Sample and pad to num_frames
    pil_frames = sample_and_pad_images(pil_frames, num_frames=req.num_frames)

    # Build prompt
    num_video_frames = getattr(model.config, "num_video_frames", req.num_frames)
    interleaved_images = "<image>\n" * (len(pil_frames) - 1)
    question = (
        f"Imagine you are a robot programmed for navigation tasks. You have been given a video "
        f'of historical observations {interleaved_images}, and current observation <image>\n. Your assigned task is: "{instruction}" '
        f"Analyze this series of images to decide your next action, which could be turning left or right by a specific "
        f"degree, moving forward a certain distance, or stop if the task is completed."
    )

    conv_mode = "llama_3"
    conv = conv_templates[conv_mode].copy()
    conv.append_message(conv.roles[0], question)
    conv.append_message(conv.roles[1], None)
    prompt = conv.get_prompt()

    # Process images
    images_tensor = process_images(pil_frames, image_processor, model.config).to(
        model.device, dtype=torch.float16
    )
    input_ids = (
        tokenizer_image_token(prompt, tokenizer, IMAGE_TOKEN_INDEX, return_tensors="pt")
        .unsqueeze(0)
        .to(model.device)
    )

    stop_str = conv.sep if conv.sep_style != SeparatorStyle.TWO else conv.sep2
    keywords = [stop_str]
    stopping_criteria = KeywordsStoppingCriteria(keywords, tokenizer, input_ids)

    # Generate
    with torch.inference_mode():
        output_ids = model.generate(
            input_ids,
            images=images_tensor,
            do_sample=False,
            temperature=0.0,
            max_new_tokens=32,
            use_cache=True,
            stopping_criteria=[stopping_criteria],
            pad_token_id=tokenizer.eos_token_id,
        )

    outputs = tokenizer.batch_decode(output_ids, skip_special_tokens=True)[0].strip()
    if outputs.endswith(stop_str):
        outputs = outputs[: -len(stop_str)].strip()

    latency_ms = (time.time() - start_time) * 1000

    # Record action in SAP memory
    if sap_controller and sap_controller.active:
        last_frame_b64 = req.frames[-1] if req.frames else ""
        sap_controller.record_action(outputs, last_frame_b64)

    # Parse action
    result = parse_action(outputs)
    result["latency_ms"] = latency_ms
    return InferenceResponse(**result)


def sample_and_pad_images(images: List[PILImage.Image], num_frames: int = 8) -> List[PILImage.Image]:
    """Sample and pad frame list to fixed length."""
    frames = copy.deepcopy(images)

    if len(frames) < num_frames:
        while len(frames) < num_frames:
            frames.insert(0, PILImage.new("RGB", (512, 512), color=(0, 0, 0)))

    latest_frame = frames[-1]
    sampled_indices = np.linspace(0, len(frames) - 1, num=num_frames - 1, endpoint=False, dtype=int)
    sampled_frames = [frames[i] for i in sampled_indices] + [latest_frame]
    return sampled_frames


def parse_action(text: str) -> dict:
    """Parse model text output into structured action."""
    patterns = {
        "stop": re.compile(r"\bstop\b", re.IGNORECASE),
        "forward": re.compile(r"\bmove forward\b", re.IGNORECASE),
        "left": re.compile(r"\bturn left\b", re.IGNORECASE),
        "right": re.compile(r"\bturn right\b", re.IGNORECASE),
    }

    action = "stop"
    for name, pattern in patterns.items():
        if pattern.search(text):
            action = name
            break

    linear_vel = 0.0
    angular_vel = 0.0

    if action == "forward":
        match = re.search(r"move forward (\d+)\s*cm", text, re.IGNORECASE)
        distance_cm = int(match.group(1)) if match else 25
        linear_vel = min(distance_cm / 100.0, 0.5)

    elif action == "left":
        match = re.search(r"turn left (\d+)\s*degree", text, re.IGNORECASE)
        degree = int(match.group(1)) if match else 15
        angular_vel = min(degree / 30.0, 1.0)

    elif action == "right":
        match = re.search(r"turn right (\d+)\s*degree", text, re.IGNORECASE)
        degree = int(match.group(1)) if match else 15
        angular_vel = -min(degree / 30.0, 1.0)

    return {
        "command": action,
        "linear_velocity": linear_vel,
        "angular_velocity": angular_vel,
        "confidence": 0.8 if action != "stop" else 0.9,
        "reasoning": text,
        "goal_reached": action == "stop",
    }


# === SAP API ===

class PlanRequest(BaseModel):
    instruction: str
    initial_frame: Optional[str] = None


@app.post("/plan")
def start_plan(req: PlanRequest):
    global sap_controller
    from planner import SAPController

    sap_controller = SAPController(verify_interval=3, max_retries=3)
    sap_controller.start(req.instruction, req.initial_frame)
    return {
        "active": sap_controller.active,
        "subtasks": sap_controller.subtasks,
        "current_subtask": sap_controller.current_subtask,
    }


@app.post("/plan_stop")
def stop_plan():
    global sap_controller
    if sap_controller:
        sap_controller.active = False
    return {"active": False}


@app.get("/sap_status")
def sap_status():
    if sap_controller:
        return sap_controller.get_status()
    return {"active": False, "subtasks": [], "current_index": 0}


@app.get("/sap_log")
def sap_log():
    if not sap_controller:
        return {"active": False, "subtasks": [], "steps": []}
    status = sap_controller.get_status()
    steps = []
    for entry in sap_controller.memory:
        if entry["type"] == "action":
            steps.append({
                "type": "action",
                "step": entry["step"],
                "subtask_id": entry["subtask_id"],
                "action": entry["action"],
                "instruction": sap_controller.subtasks[entry["subtask_id"] - 1]["instruction"] if entry["subtask_id"] <= len(sap_controller.subtasks) else "",
                "frame_b64": entry.get("frame_b64", ""),
            })
        elif entry["type"] == "verify":
            steps.append({
                "type": "verify",
                "step": entry["step"],
                "subtask_id": entry["subtask_id"],
                "status": entry["status"],
                "reason": entry["reason"],
            })
        elif entry["type"] == "replan":
            steps.append({
                "type": "replan",
                "step": entry["step"],
                "subtask_id": entry["subtask_id"],
                "old_instruction": entry["old_instruction"],
                "new_instruction": entry["new_instruction"],
                "reason": entry["reason"],
            })
    return {
        "active": status["active"],
        "subtasks": status["subtasks"],
        "current_index": status["current_index"],
        "is_complete": status["is_complete"],
        "last_verify": status["last_verify"],
        "steps": steps,
    }
