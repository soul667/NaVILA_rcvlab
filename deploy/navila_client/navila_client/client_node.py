"""NaVILA Client - ROS2 node that sends frames to remote inference server."""

import base64
import io
import time
from collections import deque
from threading import Lock

import requests
import rclpy
from cv_bridge import CvBridge
from PIL import Image as PILImage
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import Image

from navila_msgs.msg import Action, SystemStatus
from navila_msgs.srv import SetInstruction, SetMode


class NaVilaClient(Node):
    """Lightweight ROS2 node that sends camera frames to a remote NaVILA inference server."""

    def __init__(self):
        super().__init__("navila_core")

        # Parameters
        self.declare_parameter("server_url", "http://localhost:8000")
        self.declare_parameter("num_frames", 8)
        self.declare_parameter("inference_rate", 2.0)
        self.declare_parameter("instruction", "navigate to the goal")
        self.declare_parameter("jpeg_quality", 80)

        self.server_url = self.get_parameter("server_url").value
        self.num_frames = self.get_parameter("num_frames").value
        self.inference_rate = self.get_parameter("inference_rate").value
        self.instruction = self.get_parameter("instruction").value
        self.jpeg_quality = self.get_parameter("jpeg_quality").value

        # State
        self.frame_buffer = deque(maxlen=self.num_frames)
        self.lock = Lock()
        self.bridge = CvBridge()
        self.inference_count = 0
        self.last_latency = 0.0
        self.error_count = 0
        self.last_error = ""
        self.mode = "inference"
        self.server_reachable = False

        # QoS
        camera_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )

        # Subscribers
        self.rgb_sub = self.create_subscription(
            Image, "/navila/observation/rgb", self._rgb_callback, camera_qos
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
        self.status_timer = self.create_timer(5.0, self._publish_status)

        # Check server on startup
        self._check_server()
        self.get_logger().info(
            f"NaVILA Client initialized | server: {self.server_url} | "
            f"frames: {self.num_frames} | rate: {self.inference_rate}Hz"
        )

    def _check_server(self):
        """Check if inference server is reachable."""
        try:
            resp = requests.get(f"{self.server_url}/health", timeout=5)
            if resp.status_code == 200:
                status = resp.json()
                self.server_reachable = status.get("model_loaded", False)
                self.get_logger().info(
                    f"Server connected: model_loaded={self.server_reachable}, "
                    f"gpu={status.get('gpu_name', 'N/A')}"
                )
            else:
                self.server_reachable = False
                self.get_logger().warn(f"Server returned status {resp.status_code}")
        except Exception as e:
            self.server_reachable = False
            self.get_logger().warn(f"Server not reachable: {e}")

    def _rgb_callback(self, msg: Image):
        """Buffer incoming RGB frames."""
        try:
            cv_image = self.bridge.imgmsg_to_cv2(msg, desired_encoding="rgb8")
            with self.lock:
                self.frame_buffer.append(cv_image)
        except Exception as e:
            self.get_logger().warn(f"RGB conversion error: {e}")

    def _inference_loop(self):
        """Send frames to server and publish action."""
        if self.mode != "inference":
            return

        with self.lock:
            if len(self.frame_buffer) < self.num_frames:
                return
            frames = list(self.frame_buffer)

        # Encode frames as JPEG base64
        encoded_frames = []
        for frame in frames:
            pil_img = PILImage.fromarray(frame)
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=self.jpeg_quality)
            encoded_frames.append(base64.b64encode(buf.getvalue()).decode("utf-8"))

        # Call server
        try:
            start_time = time.time()
            resp = requests.post(
                f"{self.server_url}/infer",
                json={
                    "frames": encoded_frames,
                    "instruction": self.instruction,
                    "num_frames": self.num_frames,
                },
                timeout=30,
            )
            latency = (time.time() - start_time) * 1000

            if resp.status_code != 200:
                self.error_count += 1
                self.last_error = f"Server error: {resp.status_code}"
                self.get_logger().error(self.last_error)
                return

            result = resp.json()
            self.last_latency = latency
            self.server_reachable = True

            # Parse server response into action
            # Server returns: action, raw_output, distance_cm, degree, latency_ms
            action = result.get("action", "stop")
            distance_cm = result.get("distance_cm", 0)
            degree = result.get("degree", 0)
            raw_output = result.get("raw_output", "")

            # Convert to velocity commands
            linear_vel = 0.0
            angular_vel = 0.0
            goal_reached = False

            if action == "move_forward":
                linear_vel = min(distance_cm / 100.0, 0.5)
            elif action == "turn_left":
                angular_vel = min(degree / 30.0, 1.0)
            elif action == "turn_right":
                angular_vel = -min(degree / 30.0, 1.0)
            elif action == "stop":
                goal_reached = True

            # Publish action
            action_msg = Action()
            action_msg.header.stamp = self.get_clock().now().to_msg()
            action_msg.command = action
            action_msg.linear_velocity = linear_vel
            action_msg.angular_velocity = angular_vel
            action_msg.confidence = 0.9 if action == "stop" else 0.8
            action_msg.reasoning = raw_output
            action_msg.goal_reached = goal_reached

            self.action_pub.publish(action_msg)
            self.inference_count += 1

            self.get_logger().info(
                f"Action: {action} | lin={linear_vel:.2f} "
                f"ang={angular_vel:.2f} | latency={latency:.0f}ms "
                f"(server={result.get('latency_ms', 0):.0f}ms)"
            )

        except requests.exceptions.Timeout:
            self.error_count += 1
            self.last_error = "Server timeout"
            self.get_logger().warn("Inference request timed out")
        except requests.exceptions.ConnectionError:
            self.server_reachable = False
            self.error_count += 1
            self.last_error = "Server unreachable"
            self.get_logger().warn("Server connection failed, will retry...")
        except Exception as e:
            self.error_count += 1
            self.last_error = str(e)
            self.get_logger().error(f"Inference error: {e}")

    def _set_instruction_callback(self, request, response):
        self.instruction = request.instruction
        self.get_logger().info(f"Instruction set: {self.instruction}")
        response.success = True
        response.message = f"Instruction set to: {self.instruction}"
        return response

    def _set_mode_callback(self, request, response):
        valid_modes = ["idle", "inference"]
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
        status = SystemStatus()
        status.header.stamp = self.get_clock().now().to_msg()
        status.model_loaded = self.server_reachable
        status.inference_running = self.mode == "inference"
        status.camera_connected = len(self.frame_buffer) > 0
        status.robot_connected = True
        status.inference_latency_ms = self.last_latency
        status.fps = self.inference_rate if self.mode == "inference" else 0.0
        status.last_error = self.last_error
        status.error_count = self.error_count
        self.status_pub.publish(status)

        # Retry server check if not reachable
        if not self.server_reachable:
            self._check_server()


def main(args=None):
    rclpy.init(args=args)
    node = NaVilaClient()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
