"""NaVILA Core - ROS2 VLA Inference Node (Remote API Mode).

Instead of running inference locally on Jetson, this node sends frames
to a remote GPU server via HTTP API and receives navigation actions.
"""

import base64
import io
import time
from collections import deque
from threading import Lock

import rclpy
from cv_bridge import CvBridge
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import Image, CameraInfo
from std_msgs.msg import String

from navila_msgs.msg import Action, Observation, RobotState, SystemStatus
from navila_msgs.srv import SetInstruction, SetMode

try:
    import requests
except ImportError:
    requests = None


class NaVilaCore(Node):
    """VLA inference node (remote API client mode).

    Buffers camera frames and sends them to a remote inference server.
    Publishes navigation actions received from the server.
    """

    def __init__(self):
        super().__init__("navila_core")

        # Parameters
        self.declare_parameter("server_url", "http://192.168.1.100:8000")
        self.declare_parameter("num_frames", 8)
        self.declare_parameter("inference_rate", 2.0)  # Hz
        self.declare_parameter("instruction", "navigate to the goal")
        self.declare_parameter("jpeg_quality", 85)  # JPEG compression quality
        self.declare_parameter("request_timeout", 10.0)  # seconds

        self.server_url = self.get_parameter("server_url").value
        self.num_frames = self.get_parameter("num_frames").value
        self.inference_rate = self.get_parameter("inference_rate").value
        self.instruction = self.get_parameter("instruction").value
        self.jpeg_quality = self.get_parameter("jpeg_quality").value
        self.request_timeout = self.get_parameter("request_timeout").value

        # State
        self.mode = "idle"  # idle, inference, recording
        self.frame_buffer = deque(maxlen=self.num_frames)
        self.lock = Lock()
        self.bridge = CvBridge()
        self.inference_count = 0
        self.last_latency = 0.0
        self.error_count = 0
        self.last_error = ""
        self.server_connected = False

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

        # Check server connectivity
        self._check_server()

    def _check_server(self):
        """Check if the remote inference server is reachable."""
        if requests is None:
            self.get_logger().error("requests library not installed! pip install requests")
            return

        try:
            resp = requests.get(
                f"{self.server_url}/health",
                timeout=5.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                self.server_connected = data.get("model_loaded", False)
                if self.server_connected:
                    self.mode = "inference"
                    self.get_logger().info(
                        f"Server connected: {self.server_url} | "
                        f"GPU: {data.get('gpu_name')} | "
                        f"VRAM: {data.get('gpu_memory_used_mb')}MB"
                    )
                else:
                    self.get_logger().warn("Server reachable but model not loaded yet")
            else:
                self.get_logger().warn(f"Server returned status {resp.status_code}")
        except Exception as e:
            self.get_logger().warn(f"Cannot reach server at {self.server_url}: {e}")
            self.server_connected = False

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
        """Send frames to remote server for inference at fixed rate."""
        if self.mode != "inference":
            return

        with self.lock:
            if len(self.frame_buffer) < self.num_frames:
                return
            frames = list(self.frame_buffer)

        # Retry server connection if needed
        if not self.server_connected:
            self._check_server()
            if not self.server_connected:
                return

        try:
            from PIL import Image as PILImage

            start_time = time.time()

            # Encode frames as base64 JPEG
            b64_frames = []
            for f in frames:
                pil_img = PILImage.fromarray(f["rgb"])
                buf = io.BytesIO()
                pil_img.save(buf, format="JPEG", quality=self.jpeg_quality)
                b64_frames.append(base64.b64encode(buf.getvalue()).decode("ascii"))

            # Call remote API
            payload = {
                "frames": b64_frames,
                "instruction": self.instruction,
            }

            resp = requests.post(
                f"{self.server_url}/infer",
                json=payload,
                timeout=self.request_timeout,
            )

            if resp.status_code != 200:
                raise RuntimeError(f"Server error {resp.status_code}: {resp.text}")

            result = resp.json()

            total_latency = (time.time() - start_time) * 1000
            self.last_latency = total_latency

            # Parse result and publish action
            action_msg = Action()
            action_msg.header.stamp = self.get_clock().now().to_msg()
            action_msg.command = result["action"]
            action_msg.reasoning = result.get("raw_output", "")
            action_msg.confidence = 1.0

            # Convert parsed action to velocity commands
            action = result["action"]
            if action == "stop":
                action_msg.linear_velocity = 0.0
                action_msg.angular_velocity = 0.0
                action_msg.goal_reached = True
            elif action == "move_forward":
                # Convert distance to velocity (simple: fixed speed)
                action_msg.linear_velocity = 0.5  # m/s
                action_msg.angular_velocity = 0.0
                action_msg.goal_reached = False
            elif action == "turn_left":
                action_msg.linear_velocity = 0.0
                action_msg.angular_velocity = 0.5  # rad/s positive = left
                action_msg.goal_reached = False
            elif action == "turn_right":
                action_msg.linear_velocity = 0.0
                action_msg.angular_velocity = -0.5  # rad/s negative = right
                action_msg.goal_reached = False

            self.action_pub.publish(action_msg)
            self.inference_count += 1

            self.get_logger().info(
                f"Action: {action} | "
                f"Server: {result.get('latency_ms', 0):.0f}ms | "
                f"Total: {total_latency:.0f}ms"
            )

        except requests.exceptions.Timeout:
            self.error_count += 1
            self.last_error = "Request timeout"
            self.get_logger().warn(f"Inference timeout ({self.request_timeout}s)")
        except requests.exceptions.ConnectionError:
            self.error_count += 1
            self.last_error = "Connection lost"
            self.server_connected = False
            self.get_logger().warn("Lost connection to inference server")
        except Exception as e:
            self.error_count += 1
            self.last_error = str(e)
            self.get_logger().error(f"Inference error: {e}")

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
        status = SystemStatus()
        status.header.stamp = self.get_clock().now().to_msg()
        status.model_loaded = self.server_connected
        status.inference_running = self.mode == "inference"
        status.camera_connected = len(self.frame_buffer) > 0
        status.robot_connected = True  # TODO: check robot bridge heartbeat
        status.inference_latency_ms = self.last_latency
        status.fps = self.inference_rate if self.mode == "inference" else 0.0
        status.gpu_memory_used_mb = 0  # Remote GPU, not local
        status.gpu_memory_total_mb = 0
        status.gpu_utilization = 0.0
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
