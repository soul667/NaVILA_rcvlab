"""NaVILA model inference engine.

Encapsulates model loading and inference logic extracted from navila_trainer.py.
Designed to be used by the FastAPI server without modifying any original code.
"""

import copy
import re
import time
from typing import List, Optional

import numpy as np
import torch
from PIL import Image

from llava.constants import DEFAULT_IMAGE_TOKEN, IMAGE_TOKEN_INDEX
from llava.conversation import SeparatorStyle, conv_templates
from llava.mm_utils import (
    KeywordsStoppingCriteria,
    get_model_name_from_path,
    process_images,
    tokenizer_image_token,
)
from llava.model.builder import load_pretrained_model


def sample_and_pad_images(images: List[Image.Image], num_frames: int = 8) -> List[Image.Image]:
    """Sample frames uniformly and pad with black if fewer than num_frames."""
    frames = copy.deepcopy(images)

    if len(frames) < num_frames:
        # Pad with black frames at the beginning
        w, h = frames[0].size if frames else (384, 384)
        while len(frames) < num_frames:
            frames.insert(0, Image.new("RGB", (w, h), color=(0, 0, 0)))

    # Sample uniformly, always keep the latest frame as the last
    latest_frame = frames[-1]
    sampled_indices = np.linspace(0, len(frames) - 1, num=num_frames - 1, endpoint=False, dtype=int)
    sampled_frames = [frames[i] for i in sampled_indices] + [latest_frame]

    return sampled_frames


class NaVILAInference:
    """Stateful inference engine that holds the model in GPU memory."""

    def __init__(self, model_path: str, load_8bit: bool = False, load_4bit: bool = False):
        self.model_path = model_path
        self.model = None
        self.tokenizer = None
        self.image_processor = None
        self.context_len = None
        self.num_video_frames = 8
        self.conv_mode = "llama_3"
        self._loaded = False

        self._load_model(load_8bit=load_8bit, load_4bit=load_4bit)

    def _load_model(self, load_8bit: bool = False, load_4bit: bool = False):
        """Load model into GPU memory (single device)."""
        model_name = get_model_name_from_path(self.model_path)

        kwargs = {}
        if load_8bit:
            kwargs["load_8bit"] = True
        if load_4bit:
            kwargs["load_4bit"] = True

        # Force single GPU to avoid device mismatch with accelerate's device_map="auto"
        kwargs["device_map"] = {"": "cuda:0"}

        self.tokenizer, self.model, self.image_processor, self.context_len = load_pretrained_model(
            self.model_path, model_name, **kwargs
        )
        self.model.eval()

        # Read num_video_frames from model config
        if hasattr(self.model.config, "num_video_frames"):
            self.num_video_frames = self.model.config.num_video_frames

        self._loaded = True

    @property
    def is_loaded(self) -> bool:
        return self._loaded

    def infer(self, frames: List[Image.Image], instruction: str) -> dict:
        """
        Run inference on a list of PIL Image frames with a navigation instruction.

        Args:
            frames: List of PIL RGB images (any size, will be preprocessed).
            instruction: Navigation instruction text.

        Returns:
            dict with keys:
                - raw_output: raw model text output
                - action: parsed action string (stop/move_forward/turn_left/turn_right)
                - distance_cm: distance in cm (for move_forward)
                - degree: degree (for turn_left/turn_right)
                - latency_ms: inference latency in milliseconds
        """
        if not self._loaded:
            raise RuntimeError("Model not loaded")

        start_time = time.time()

        # Sample and pad to num_video_frames
        sampled_frames = sample_and_pad_images(frames, num_frames=self.num_video_frames)

        # Build prompt (same format as navila_trainer.py)
        interleaved_images = "<image>\n" * (len(sampled_frames) - 1)
        question = (
            f"Imagine you are a robot programmed for navigation tasks. You have been given a video "
            f'of historical observations {interleaved_images}, and current observation <image>\n. Your assigned task is: "{instruction}" '
            f"Analyze this series of images to decide your next action, which could be turning left or right by a specific "
            f"degree, moving forward a certain distance, or stop if the task is completed."
        )

        conv = conv_templates[self.conv_mode].copy()
        conv.append_message(conv.roles[0], question)
        conv.append_message(conv.roles[1], None)
        prompt = conv.get_prompt()

        # Process images
        images_tensor = process_images(sampled_frames, self.image_processor, self.model.config).to(
            "cuda:0", dtype=torch.float16
        )
        input_ids = (
            tokenizer_image_token(prompt, self.tokenizer, IMAGE_TOKEN_INDEX, return_tensors="pt")
            .unsqueeze(0)
            .to("cuda:0")
        )

        # Stopping criteria
        stop_str = conv.sep if conv.sep_style != SeparatorStyle.TWO else conv.sep2
        keywords = [stop_str]
        stopping_criteria = KeywordsStoppingCriteria(keywords, self.tokenizer, input_ids)

        # Generate
        with torch.inference_mode():
            output_ids = self.model.generate(
                input_ids,
                images=images_tensor,
                do_sample=False,
                temperature=0.0,
                max_new_tokens=32,
                use_cache=True,
                stopping_criteria=[stopping_criteria],
                pad_token_id=self.tokenizer.eos_token_id,
            )

        outputs = self.tokenizer.batch_decode(output_ids, skip_special_tokens=True)[0].strip()
        if outputs.endswith(stop_str):
            outputs = outputs[: -len(stop_str)]
        outputs = outputs.strip()

        latency_ms = (time.time() - start_time) * 1000

        # Parse action
        result = self._parse_action(outputs)
        result["raw_output"] = outputs
        result["latency_ms"] = round(latency_ms, 1)

        return result

    @staticmethod
    def _parse_action(text: str) -> dict:
        """Parse model output text into structured action."""
        patterns = {
            "stop": re.compile(r"\bstop\b", re.IGNORECASE),
            "move_forward": re.compile(r"\bis move forward\b", re.IGNORECASE),
            "turn_left": re.compile(r"\bis turn left\b", re.IGNORECASE),
            "turn_right": re.compile(r"\bis turn right\b", re.IGNORECASE),
        }

        action = "stop"
        for act, pattern in patterns.items():
            if pattern.search(text):
                action = act
                break

        result = {"action": action, "distance_cm": 0, "degree": 0}

        if action == "move_forward":
            match = re.search(r"move forward (\d+)\s*cm", text)
            distance = int(match.group(1)) if match else 25
            # Snap to valid distances
            if distance % 25 != 0:
                distance = min([25, 50, 75, 100], key=lambda x: abs(x - distance))
            result["distance_cm"] = distance

        elif action in ("turn_left", "turn_right"):
            match = re.search(r"turn (?:left|right) (\d+)\s*degree", text)
            degree = int(match.group(1)) if match else 15
            # Snap to valid degrees
            if degree % 15 != 0:
                degree = min([15, 30, 45, 60, 90], key=lambda x: abs(x - degree))
            result["degree"] = degree

        return result
