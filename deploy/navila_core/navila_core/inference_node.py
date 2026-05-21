"""NaVILA Core - ROS2 VLA Inference Node."""

import time
from collections import deque
from threading import Lock
from typing import Optional

import rclpy
from cv_bridge import CvBridge
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import Image, CameraInfo
from std_msgs.msg import String

from navila_msgs.msg import Action, Observation, RobotState, SystemStatus
from navila_msgs.srv import SetInstruction, SetMode


class NaVilaCore(Node):
    """Main VLA inference node. Subscribes to camera observations, publishes navigation actions."""

    def __init__(self):
        super().__init__("navila_core")

        # Parameters
        self.declare_parameter("model_path", "a8cheng/navila-llama3-8b-8f")
        self.declare_parameter("num_frames", 8)
        self.declare_parameter("inference_rate", 2.0)  # Hz
        self.declare_parameter("device", "cuda:0")
        self.declare_parameter("instruction", "navigate to the goal")

        self.model_path = self.get_parameter("model_path").value
        self.num_frames = self.get_parameter("num_frames").value
        self.inference_rate = self.get_parameter("inference_rate").value
        self.device = self.get_parameter("device").value
        self.instruction = self.get_parameter("instruction").value

        # State
        self.model = None
        self.model_loaded = False
        self.mode = "idle"  # idle, inference, recording
        self.frame_buffer = deque(maxlen=self.num_frames)
        self.lock = Lock()
        self.bridge = CvBridge()
        self.inference_count = 0
        self.last_latency = 0.0
        self.error_count = 0
        self.last_error = ""

        # QoS for camera (best effort, keep last)
        camera_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )

        # Subscribers
        self.rgb_sub = self.create_subscription(
            Image, "/navila/observation/rgb", self._rgb_callback, camera_qos
        )
        self.depth_sub = self.create_subscription(
            Image, "/navila/observation/depth", self._depth_callback, camera_qos
        )

        # Publishers
        self.action_pub = self.create_publisher(Action, "/navila/action", 10)
        self.status_pub = self.create_publisher(SystemStatus, "/navila/status", 10)

        # Services
        self.set_instruction_srv = self.create_service(
            SetInstruction, "/navila/set_instruction", self._set_instruction_callback
        )
        self.set_mode_srv = self.create_service(
            SetMode, "/navila/set_mode", self._set_mode_callback
        )

        # Timers
        self.inference_timer = self.create_timer(
            1.0 / self.inference_rate, self._inference_loop
        )
        self.status_timer = self.create_timer(1.0, self._publish_status)

        # Load model in background
        self.get_logger().info(f"Loading model from {self.model_path}...")
        self._load_model()

    def _load_model(self):
        """Load the NaVILA model."""
        try:
            import torch
            from llava.entry import load

            self.model = load(self.model_path, device=self.device)
            self.model.eval()
            self.model_loaded = True
            self.mode = "inference"
            self.get_logger().info("Model loaded successfully.")
        except Exception as e:
            self.last_error = str(e)
            self.error_count += 1
            self.get_logger().error(f"Failed to load model: {e}")

    def _rgb_callback(self, msg: Image):
        """Buffer incoming RGB frames."""
        try:
            cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding="rgb8")
            with self.lock:
                self.frame_buffer.append(
                    {"rgb": cv_image, "timestamp": msg.header.stamp}
                )
        except Exception as e:
            self.get_logger().warn(f"RGB conversion error: {e}")

    def _depth_callback(self, msg: Image):
        """Store latest depth frame (optional, for future use)."""
        pass

    def _inference_loop(self):
        """Run VLA inference at fixed rate."""
        if self.mode != "inference" or not self.model_loaded:
            return

        with self.lock:
            if len(self.frame_buffer) < self.num_frames:
                return
            frames = list(self.frame_buffer)

        try:
            import torch
            import numpy as np
            from llava.conversation import auto_set_conversation_mode
            from llava.mm_utils import process_images, tokenizer_image_token
            from PIL import Image as PILImage

            start_time = time.time()

            # Convert frames to PIL images
            pil_frames = [PILImage.fromarray(f["rgb"]) for f in frames]

            # Run inference (simplified - actual implementation depends on model API)
            with torch.no_grad():
                # The actual inference call will depend on the model's API
                # This is a placeholder for the real inference pipeline
                output = self._run_model_inference(pil_frames, self.instruction)

            latency = (time.time() - start_time) * 1000
            self.last_latency = latency

            # Publish action
            action_msg = Action()
            action_msg.header.stamp = self.get_clock().now().to_msg()
            action_msg.command = output.get("command", "stop")
            action_msg.angular_velocity = output.get("angular_velocity", 0.0)
            action_msg.linear_velocity = output.get("linear_velocity", 0.0)
            action_msg.confidence = output.get("confidence", 0.0)
            action_msg.reasoning = output.get("reasoning", "")
            action_msg.goal_reached = output.get("goal_reached", False)

            self.action_pub.publish(action_msg)
            self.inference_count += 1

        except Exception as e:
            self.error_count += 1
            self.last_error = str(e)
            self.get_logger().error(f"Inference error: {e}")

    def _run_model_inference(self, frames, instruction: str) -> dict:
        """
        Run the actual NaVILA model inference.
        Override this method for different model versions.

        Returns dict with keys: command, angular_velocity, linear_velocity,
                                confidence, reasoning, goal_reached
        """
        # TODO: Implement actual model inference pipeline
        # This requires integrating with the VILA conversation/generation API
        # The model outputs text like "turn left" which needs to be parsed
        # into structured commands

        # Placeholder - replace with actual model call
        return {
            "command": "stop",
            "angular_velocity": 0.0,
            "linear_velocity": 0.0,
            "confidence": 0.0,
            "reasoning": "model inference not yet implemented",
            "goal_reached": False,
        }

    def _set_instruction_callback(self, request, response):
        """Service: set navigation instruction."""
        self.instruction = request.instruction
        self.get_logger().info(f"Instruction set: {self.instruction}")
        response.success = True
        response.message = f"Instruction set to: {self.instruction}"
        return response

    def _set_mode_callback(self, request, response):
        """Service: set system mode."""
        valid_modes = ["idle", "inference", "recording"]
        if request.mode not in valid_modes:
            response.success = False
            response.message = f"Invalid mode. Valid: {valid_modes}"
            return response

        self.mode = request.mode
        self.get_logger().info(f"Mode set: {self.mode}")
        response.success = True
        response.message = f"Mode set to: {self.mode}"
        return response

    def _publish_status(self):
        """Publish system status at 1Hz."""
        try:
            import torch

            gpu_mem_used = torch.cuda.memory_allocated() // (1024 * 1024)
            gpu_mem_total = torch.cuda.get_device_properties(0).total_mem // (1024 * 1024)
            gpu_util = 0.0  # Would need nvidia-smi or pynvml for real utilization
        except Exception:
            gpu_mem_used = 0
            gpu_mem_total = 0
            gpu_util = 0.0

        status = SystemStatus()
        status.header.stamp = self.get_clock().now().to_msg()
        status.model_loaded = self.model_loaded
        status.inference_running = self.mode == "inference"
        status.camera_connected = len(self.frame_buffer) > 0
        status.robot_connected = True  # TODO: check robot bridge heartbeat
        status.inference_latency_ms = self.last_latency
        status.fps = self.inference_rate if self.mode == "inference" else 0.0
        status.gpu_memory_used_mb = gpu_mem_used
        status.gpu_memory_total_mb = gpu_mem_total
        status.gpu_utilization = gpu_util
        status.last_error = self.last_error
        status.error_count = self.error_count

        self.status_pub.publish(status)


def main(args=None):
    rclpy.init(args=args)
    node = NaVilaCore()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
