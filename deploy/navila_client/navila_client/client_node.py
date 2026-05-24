"""NaVILA Client - ROS2 node that sends frames to remote inference server.

Control flow:
  1. Collect frames from camera
  2. Send to inference server, get action (e.g. "move_forward 25cm")
  3. Convert distance/angle to execution time at fixed speed ratio
  4. Send velocity command for calculated duration
  5. Send zero velocity (stop)
  6. Wait for robot to stabilize
  7. Go back to step 1
"""

import base64
import io
import time
from collections import deque
from enum import Enum
from threading import Lock, Thread

import requests
import rclpy
from cv_bridge import CvBridge
from PIL import Image as PILImage
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from sensor_msgs.msg import Image

from navila_msgs.msg import Action, SystemStatus
from navila_msgs.srv import SetInstruction, SetMode


class State(Enum):
    IDLE = "idle"
    WAITING_FRAMES = "waiting_frames"
    INFERRING = "inferring"
    EXECUTING = "executing"
    STOPPING = "stopping"
    STABILIZING = "stabilizing"


class NaVilaClient(Node):
    """Step-by-step navigation: infer once → execute → stop → wait → repeat."""

    def __init__(self):
        super().__init__("navila_core")

        # Parameters
        self.declare_parameter("server_url", "http://localhost:8000")
        self.declare_parameter("num_frames", 8)
        self.declare_parameter("instruction", "navigate to the goal")
        self.declare_parameter("jpeg_quality", 80)

        # Motion parameters (tune these for your robot)
        # Speed ratios sent to robot ([-1, 1] range)
        self.declare_parameter("forward_speed_ratio", 0.3)  # x ratio when moving forward
        self.declare_parameter("turn_speed_ratio", 0.3)     # yaw ratio when turning
        # Estimated real-world speeds at these ratios (measure on your robot!)
        self.declare_parameter("forward_speed_ms", 0.2)     # m/s at forward_speed_ratio
        self.declare_parameter("turn_speed_degs", 30.0)     # deg/s at turn_speed_ratio
        # Timing
        self.declare_parameter("stop_duration", 0.5)        # seconds to send zero vel after action
        self.declare_parameter("stabilize_duration", 1.0)   # seconds to wait before next inference

        self.server_url = self.get_parameter("server_url").value
        self.num_frames = self.get_parameter("num_frames").value
        self.instruction = self.get_parameter("instruction").value
        self.jpeg_quality = self.get_parameter("jpeg_quality").value

        self.forward_speed_ratio = self.get_parameter("forward_speed_ratio").value
        self.turn_speed_ratio = self.get_parameter("turn_speed_ratio").value
        self.forward_speed_ms = self.get_parameter("forward_speed_ms").value
        self.turn_speed_degs = self.get_parameter("turn_speed_degs").value
        self.stop_duration = self.get_parameter("stop_duration").value
        self.stabilize_duration = self.get_parameter("stabilize_duration").value

        # State machine
        self.state = State.IDLE
        self.mode = "inference"  # "inference" or "idle"
        self.frame_buffer = deque(maxlen=self.num_frames)
        self.lock = Lock()
        self.bridge = CvBridge()

        # Current action execution state
        self.current_action = None       # action dict from server
        self.action_start_time = 0.0
        self.action_duration = 0.0       # how long to execute (seconds)
        self.stop_start_time = 0.0
        self.stabilize_start_time = 0.0

        # Stats
        self.inference_count = 0
        self.last_latency = 0.0
        self.error_count = 0
        self.last_error = ""
        self.server_reachable = False

        # QoS - use RELIABLE to match oli_bridge publisher
        camera_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
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

        # Main loop timer (30Hz to handle execution timing precisely)
        self.main_timer = self.create_timer(1.0 / 30.0, self._main_loop)
        self.status_timer = self.create_timer(5.0, self._publish_status)

        # Check server on startup
        self._check_server()
        if self.server_reachable and self.mode == "inference":
            self.state = State.WAITING_FRAMES

        self.get_logger().info(
            f"NaVILA Client initialized | server: {self.server_url} | "
            f"frames: {self.num_frames} | "
            f"forward: {self.forward_speed_ratio} ratio @ ~{self.forward_speed_ms} m/s | "
            f"turn: {self.turn_speed_ratio} ratio @ ~{self.turn_speed_degs} deg/s"
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

    def _main_loop(self):
        """State machine main loop (30Hz)."""
        if self.mode != "inference":
            return

        now = time.time()

        if self.state == State.WAITING_FRAMES:
            with self.lock:
                if len(self.frame_buffer) >= self.num_frames:
                    self.state = State.INFERRING
                    # Run inference in a separate thread to avoid blocking ROS2
                    Thread(target=self._do_inference, daemon=True).start()

        elif self.state == State.EXECUTING:
            # Check if execution time is up
            elapsed = now - self.action_start_time
            if elapsed >= self.action_duration:
                # Time's up, stop the robot
                self._publish_stop()
                self.stop_start_time = now
                self.state = State.STOPPING
                self.get_logger().info(
                    f"Action complete (executed {elapsed:.2f}s), stopping..."
                )
            else:
                # Keep sending the velocity command
                self._publish_current_action()

        elif self.state == State.STOPPING:
            # Send zero velocity for stop_duration
            elapsed = now - self.stop_start_time
            if elapsed >= self.stop_duration:
                self.stabilize_start_time = now
                self.state = State.STABILIZING
                self.get_logger().info("Stabilizing...")
            else:
                self._publish_stop()

        elif self.state == State.STABILIZING:
            # Wait for robot to stabilize before next inference
            elapsed = now - self.stabilize_start_time
            if elapsed >= self.stabilize_duration:
                self.state = State.WAITING_FRAMES
                self.get_logger().info("Ready for next inference")

    def _do_inference(self):
        """Send frames to server and start action execution."""
        with self.lock:
            frames = list(self.frame_buffer)

        # Encode frames as JPEG base64
        encoded_frames = []
        for frame in frames:
            pil_img = PILImage.fromarray(frame)
            buf = io.BytesIO()
            pil_img.save(buf, format="JPEG", quality=self.jpeg_quality)
            encoded_frames.append(base64.b64encode(buf.getvalue()).decode("utf-8"))

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
                self.state = State.WAITING_FRAMES
                return

            result = resp.json()
            self.last_latency = latency
            self.server_reachable = True
            self.inference_count += 1

            # Parse server response
            action = result.get("action", "stop")
            distance_cm = result.get("distance_cm", 0)
            degree = result.get("degree", 0)
            raw_output = result.get("raw_output", "")

            self.get_logger().info(
                f"[Inference #{self.inference_count}] {raw_output} | "
                f"action={action} dist={distance_cm}cm deg={degree}° | "
                f"latency={latency:.0f}ms"
            )

            if action == "stop":
                # Goal reached, publish stop and go idle
                self._publish_goal_reached(raw_output)
                self.state = State.STABILIZING
                self.stabilize_start_time = time.time()
                self.get_logger().info("Goal reached! Stopping.")
                return

            # Calculate execution duration based on distance/angle
            duration = self._calculate_duration(action, distance_cm, degree)

            self.current_action = {
                "action": action,
                "distance_cm": distance_cm,
                "degree": degree,
                "raw_output": raw_output,
            }
            self.action_duration = duration
            self.action_start_time = time.time()
            self.state = State.EXECUTING

            self.get_logger().info(
                f"Executing: {action} for {duration:.2f}s"
            )

            # Publish first action immediately
            self._publish_current_action()

        except requests.exceptions.Timeout:
            self.error_count += 1
            self.last_error = "Server timeout"
            self.get_logger().warn("Inference request timed out")
            self.state = State.WAITING_FRAMES
        except requests.exceptions.ConnectionError:
            self.server_reachable = False
            self.error_count += 1
            self.last_error = "Server unreachable"
            self.get_logger().warn("Server connection failed")
            self.state = State.WAITING_FRAMES
        except Exception as e:
            self.error_count += 1
            self.last_error = str(e)
            self.get_logger().error(f"Inference error: {e}")
            self.state = State.WAITING_FRAMES

    def _calculate_duration(self, action: str, distance_cm: int, degree: int) -> float:
        """Calculate how long to execute the action based on distance/angle.

        Uses configured speed estimates:
          - forward: duration = distance / forward_speed_ms
          - turn: duration = degree / turn_speed_degs
        """
        if action == "move_forward":
            distance_m = distance_cm / 100.0
            duration = distance_m / self.forward_speed_ms
        elif action in ("turn_left", "turn_right"):
            duration = abs(degree) / self.turn_speed_degs
        else:
            duration = 0.0

        # Clamp to reasonable range
        return max(0.1, min(duration, 10.0))

    def _publish_current_action(self):
        """Publish the current action velocity command.

        Publishes ratio values [-1, 1] directly.
        oli_bridge will pass them through to the robot as-is.
        """
        if not self.current_action:
            return

        action_msg = Action()
        action_msg.header.stamp = self.get_clock().now().to_msg()
        action_msg.command = self.current_action["action"]
        action_msg.reasoning = self.current_action["raw_output"]
        action_msg.goal_reached = False

        action = self.current_action["action"]
        if action == "move_forward":
            action_msg.linear_velocity = self.forward_speed_ratio
            action_msg.angular_velocity = 0.0
        elif action == "turn_left":
            action_msg.linear_velocity = 0.0
            action_msg.angular_velocity = self.turn_speed_ratio
        elif action == "turn_right":
            action_msg.linear_velocity = 0.0
            action_msg.angular_velocity = -self.turn_speed_ratio

        action_msg.confidence = 0.8
        self.action_pub.publish(action_msg)

    def _publish_stop(self):
        """Publish zero velocity."""
        action_msg = Action()
        action_msg.header.stamp = self.get_clock().now().to_msg()
        action_msg.command = "stop"
        action_msg.linear_velocity = 0.0
        action_msg.angular_velocity = 0.0
        action_msg.confidence = 1.0
        action_msg.goal_reached = False
        action_msg.reasoning = ""
        self.action_pub.publish(action_msg)

    def _publish_goal_reached(self, reasoning: str):
        """Publish goal reached action."""
        action_msg = Action()
        action_msg.header.stamp = self.get_clock().now().to_msg()
        action_msg.command = "stop"
        action_msg.linear_velocity = 0.0
        action_msg.angular_velocity = 0.0
        action_msg.confidence = 1.0
        action_msg.goal_reached = True
        action_msg.reasoning = reasoning
        self.action_pub.publish(action_msg)

    def _set_instruction_callback(self, request, response):
        self.instruction = request.instruction
        # Also sync to server
        try:
            requests.post(
                f"{self.server_url}/set_instruction",
                json={"instruction": self.instruction},
                timeout=3,
            )
        except Exception:
            pass
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
        if self.mode == "inference":
            self.state = State.WAITING_FRAMES
        else:
            self.state = State.IDLE
            self._publish_stop()
        self.get_logger().info(f"Mode set: {self.mode}, state: {self.state.value}")
        response.success = True
        response.message = f"Mode set to: {self.mode}"
        return response

    def _publish_status(self):
        status = SystemStatus()
        status.header.stamp = self.get_clock().now().to_msg()
        status.model_loaded = self.server_reachable
        status.inference_running = self.state != State.IDLE
        status.camera_connected = len(self.frame_buffer) > 0
        status.robot_connected = True
        status.inference_latency_ms = self.last_latency
        status.fps = 0.0
        status.last_error = self.last_error
        status.error_count = self.error_count
        self.status_pub.publish(status)

        # Log current state
        self.get_logger().info(
            f"[Status] state={self.state.value} | frames={len(self.frame_buffer)} | "
            f"inferences={self.inference_count} | errors={self.error_count}"
        )

        # Retry server check if not reachable
        if not self.server_reachable:
            self._check_server()
            if self.server_reachable and self.state == State.IDLE and self.mode == "inference":
                self.state = State.WAITING_FRAMES


def main(args=None):
    rclpy.init(args=args)
    node = NaVilaClient()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
