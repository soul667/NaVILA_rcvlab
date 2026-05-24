"""
LimX OLI Humanoid Robot Bridge Node.

Converts NaVILA Action messages to LimX OLI WebSocket protocol (request_set_walk_vel_sync).
Maintains 30Hz+ continuous command sending as required by the robot.

Protocol reference:
  - WebSocket port: 5000
  - Command: request_set_walk_vel_sync
  - Data: x (forward [-1,1]), y (lateral [-1,1]), yaw (rotation [-1,1])
  - All values are velocity RATIOS, not absolute values
"""

import json
import time
import uuid
import threading
from typing import Optional

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from geometry_msgs.msg import PoseStamped, TwistStamped
from sensor_msgs.msg import Image, JointState
from nav_msgs.msg import Odometry

from navila_msgs.msg import Action, RobotState

try:
    import websocket
except ImportError:
    websocket = None


class OLiBridge(Node):
    """
    Bridge between NaVILA standard interface and LimX OLI humanoid robot.

    Architecture:
        NaVILA (2Hz inference) -> /navila/action -> OLiBridge -> WebSocket (30Hz) -> OLI Robot

    The bridge implements "hold-last-command" pattern:
        - NaVILA publishes actions at ~2Hz
        - Bridge caches the latest command
        - A 30Hz timer continuously sends the cached command via WebSocket
        - This satisfies the robot's >=30Hz command requirement

    WebSocket Protocol:
        - Connect to ws://<robot_ip>:5000
        - Send request_set_walk_vel_sync JSON messages
        - Listen for response_set_walk_vel_sync (error notifications)
        - Listen for notify_* messages (robot status pushes)
    """

    def __init__(self):
        super().__init__("oli_bridge")

        # =====================================================================
        # Parameters
        # =====================================================================
        # NaVILA velocity limits (clamp incoming action before conversion)
        self.declare_parameter("max_linear_vel", 0.5)    # m/s from NaVILA
        self.declare_parameter("max_angular_vel", 1.0)   # rad/s from NaVILA

        # Robot physical limits (for ratio conversion)
        self.declare_parameter("robot_max_linear_vel", 0.8)   # m/s at ratio=1.0
        self.declare_parameter("robot_max_lateral_vel", 0.3)  # m/s at ratio=1.0
        self.declare_parameter("robot_max_angular_vel", 1.0)  # rad/s at ratio=1.0

        # WebSocket connection
        self.declare_parameter("robot_ip", "10.192.1.2")
        self.declare_parameter("ws_port", 5000)
        self.declare_parameter("robot_accid", "HU_D04_01_001")

        # Control rate (must be >= 30Hz per robot protocol)
        self.declare_parameter("send_rate", 30.0)

        # Timeout: if no new action received for this long, send stop
        self.declare_parameter("action_timeout", 2.0)  # seconds

        # Camera topic (RealSense mounted on robot)
        self.declare_parameter("camera_topic", "/camera/camera/color/image_raw")

        # Robot sensor topics (odom/joints from OLI)
        self.declare_parameter("odom_topic", "/oli/odom")
        self.declare_parameter("joint_topic", "/oli/joint_states")

        # Reconnect interval
        self.declare_parameter("reconnect_interval", 3.0)  # seconds

        # Debug mode: log commands without actually sending via WebSocket
        self.declare_parameter("dry_run", False)

        # --- Read parameters ---
        self.max_linear_vel = self.get_parameter("max_linear_vel").value
        self.max_angular_vel = self.get_parameter("max_angular_vel").value
        self.robot_max_linear_vel = self.get_parameter("robot_max_linear_vel").value
        self.robot_max_lateral_vel = self.get_parameter("robot_max_lateral_vel").value
        self.robot_max_angular_vel = self.get_parameter("robot_max_angular_vel").value

        robot_ip = self.get_parameter("robot_ip").value
        ws_port = self.get_parameter("ws_port").value
        self.robot_accid = self.get_parameter("robot_accid").value
        self.send_rate = self.get_parameter("send_rate").value
        self.action_timeout = self.get_parameter("action_timeout").value
        self.reconnect_interval = self.get_parameter("reconnect_interval").value
        self.dry_run = self.get_parameter("dry_run").value

        camera_topic = self.get_parameter("camera_topic").value
        odom_topic = self.get_parameter("odom_topic").value
        joint_topic = self.get_parameter("joint_topic").value

        self.ws_url = f"ws://{robot_ip}:{ws_port}"

        # =====================================================================
        # State
        # =====================================================================
        # Cached velocity command (ratios [-1, 1])
        self.cmd_x = 0.0    # forward/backward ratio
        self.cmd_y = 0.0    # lateral ratio
        self.cmd_yaw = 0.0  # rotation ratio
        self.cmd_lock = threading.Lock()

        self.last_action_time = time.time()
        self.ws: Optional[websocket.WebSocket] = None
        self.ws_connected = False
        self.last_reconnect_attempt = 0.0

        # State caches for robot state publishing
        self.latest_odom = None
        self.latest_joints = None

        # Error tracking
        self.error_count = 0
        self.last_error = ""

        # =====================================================================
        # QoS
        # =====================================================================
        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )

        # =====================================================================
        # ROS2 Subscribers
        # =====================================================================
        # NaVILA action input
        self.action_sub = self.create_subscription(
            Action, "/navila/action", self._action_callback, 10
        )

        # Camera: use compatible QoS (RELIABLE to match RealSense publisher)
        camera_qos = QoSProfile(
            reliability=ReliabilityPolicy.RELIABLE,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )
        self.camera_sub = self.create_subscription(
            Image, camera_topic, self._camera_callback, camera_qos
        )
        self.odom_sub = self.create_subscription(
            Odometry, odom_topic, self._odom_callback, sensor_qos
        )
        self.joint_sub = self.create_subscription(
            JointState, joint_topic, self._joint_callback, sensor_qos
        )

        # =====================================================================
        # ROS2 Publishers
        # =====================================================================
        self.rgb_pub = self.create_publisher(Image, "/navila/observation/rgb", 10)
        self.state_pub = self.create_publisher(RobotState, "/navila/robot_state", 10)

        # =====================================================================
        # WebSocket Connection
        # =====================================================================
        if not self.dry_run:
            self._connect_websocket()

            # Start WebSocket receive thread (for response/notify messages)
            self.ws_recv_thread = threading.Thread(
                target=self._ws_receive_loop, daemon=True
            )
            self.ws_recv_thread.start()
        else:
            self.get_logger().warn(
                "*** DRY RUN MODE *** WebSocket disabled. "
                "Commands will be logged but NOT sent to robot."
            )

        # =====================================================================
        # Timers
        # =====================================================================
        # 30Hz command sender
        self.cmd_timer = self.create_timer(1.0 / self.send_rate, self._send_walk_cmd)

        # 1Hz status log
        self.status_timer = self.create_timer(5.0, self._log_status)

        self.get_logger().info(
            f"OLI Bridge initialized | WS: {self.ws_url} | "
            f"accid: {self.robot_accid} | rate: {self.send_rate}Hz | "
            f"dry_run: {self.dry_run}"
        )

    # =========================================================================
    # WebSocket Connection Management
    # =========================================================================

    def _connect_websocket(self):
        """Establish WebSocket connection to OLI robot."""
        if websocket is None:
            self.get_logger().error(
                "websocket-client not installed! Run: pip install websocket-client"
            )
            return

        try:
            self.ws = websocket.WebSocket()
            self.ws.connect(self.ws_url, timeout=5)
            self.ws.settimeout(0.1)  # Non-blocking reads for receive thread
            self.ws_connected = True
            self.get_logger().info(f"WebSocket connected to {self.ws_url}")
        except Exception as e:
            self.ws_connected = False
            self.get_logger().error(f"WebSocket connection failed: {e}")
            self.last_error = f"WS connect failed: {e}"
            self.error_count += 1

    def _reconnect_websocket(self):
        """Attempt to reconnect with rate limiting."""
        now = time.time()
        if now - self.last_reconnect_attempt < self.reconnect_interval:
            return
        self.last_reconnect_attempt = now

        self.get_logger().info("Attempting WebSocket reconnection...")
        try:
            if self.ws:
                self.ws.close()
        except Exception:
            pass
        self._connect_websocket()

    def _ws_receive_loop(self):
        """
        Background thread to receive WebSocket messages from robot.
        Handles response_set_walk_vel_sync (errors) and notify_* messages.
        """
        while rclpy.ok():
            if not self.ws_connected or self.ws is None:
                time.sleep(0.5)
                continue

            try:
                raw = self.ws.recv()
                if not raw:
                    continue
                msg = json.loads(raw)
                self._handle_robot_message(msg)
            except websocket.WebSocketTimeoutException:
                continue
            except websocket.WebSocketConnectionClosedException:
                self.ws_connected = False
                self.get_logger().warn("WebSocket connection closed by robot")
            except Exception as e:
                self.get_logger().debug(f"WS recv error: {e}")
                time.sleep(0.1)

    def _handle_robot_message(self, msg: dict):
        """Process incoming messages from the robot."""
        title = msg.get("title", "")

        if title == "response_set_walk_vel_sync":
            # Only received on failure
            result = msg.get("data", {}).get("result", "unknown")
            self.last_error = f"walk_vel_sync failed: {result}"
            self.error_count += 1
            self.get_logger().warn(f"Walk command failed: {result}")

            # If mode invalid, stop sending
            if result == "fail_invalid_mode":
                self.get_logger().error(
                    "Robot is in a mode that doesn't accept walk commands! "
                    "Ensure robot is in 移动操作模式 or 动作库模式."
                )

        elif title.startswith("notify_"):
            # Robot status push notifications
            self.get_logger().info(f"Robot notification: {title} -> {msg.get('data')}")

    # =========================================================================
    # NaVILA Action -> Cached Command
    # =========================================================================

    def _action_callback(self, msg: Action):
        """
        Convert NaVILA Action to velocity ratios and cache for 30Hz sending.

        NaVILA outputs:
          - linear_velocity (m/s): forward/backward
          - angular_velocity (rad/s): yaw rotation
          - command: "go_forward", "turn_left", "turn_right", "stop"

        OLI expects:
          - x: forward/backward ratio [-1, 1]
          - y: lateral ratio [-1, 1] (NaVILA doesn't use lateral)
          - yaw: rotation ratio [-1, 1]
        """
        with self.cmd_lock:
            if msg.goal_reached or msg.command == "stop":
                self.cmd_x = 0.0
                self.cmd_y = 0.0
                self.cmd_yaw = 0.0
            else:
                # Direct pass-through: client_node already sends ratio [-1, 1]
                self.cmd_x = self._clamp(msg.linear_velocity, -1.0, 1.0)
                self.cmd_y = 0.0
                self.cmd_yaw = self._clamp(msg.angular_velocity, -1.0, 1.0)

            self.last_action_time = time.time()

        self.get_logger().debug(
            f"Action: cmd={msg.command} -> x={self.cmd_x:.3f}, yaw={self.cmd_yaw:.3f}"
        )

    # =========================================================================
    # 30Hz WebSocket Command Sender
    # =========================================================================

    def _send_walk_cmd(self):
        """
        Send request_set_walk_vel_sync at 30Hz via WebSocket.
        Implements hold-last-command pattern with timeout safety.
        In dry_run mode, logs the command instead of sending.
        """
        # Check for action timeout -> stop robot if no recent command
        if time.time() - self.last_action_time > self.action_timeout:
            with self.cmd_lock:
                self.cmd_x = 0.0
                self.cmd_y = 0.0
                self.cmd_yaw = 0.0

        # Read cached command
        with self.cmd_lock:
            x = self.cmd_x
            y = self.cmd_y
            yaw = self.cmd_yaw

        # Build request_set_walk_vel_sync message
        msg = {
            "accid": self.robot_accid,
            "title": "request_set_walk_vel_sync",
            "timestamp": int(time.time() * 1000),
            "guid": uuid.uuid4().hex,
            "data": {
                "x": round(x, 4),
                "y": round(y, 4),
                "yaw": round(yaw, 4),
            },
        }

        # --- Dry run: only log, don't send ---
        if self.dry_run:
            # Log at reduced rate (every 1s instead of 30Hz) to avoid spam
            if not hasattr(self, '_dry_run_counter'):
                self._dry_run_counter = 0
            self._dry_run_counter += 1
            if self._dry_run_counter >= int(self.send_rate):  # once per second
                self._dry_run_counter = 0
                self.get_logger().info(
                    f"[DRY RUN] Would send: x={x:.3f} y={y:.3f} yaw={yaw:.3f}"
                )
            return

        # --- Real mode: send via WebSocket ---
        if not self.ws_connected:
            self._reconnect_websocket()
            if not self.ws_connected:
                return

        try:
            self.ws.send(json.dumps(msg))
        except Exception as e:
            self.get_logger().warn(f"WebSocket send failed: {e}")
            self.ws_connected = False
            self.last_error = f"WS send failed: {e}"
            self.error_count += 1

    # =========================================================================
    # Camera & State Forwarding
    # =========================================================================

    def _camera_callback(self, msg: Image):
        """Forward robot camera to NaVILA standard topic."""
        self.rgb_pub.publish(msg)
        if not hasattr(self, '_camera_forwarded'):
            self._camera_forwarded = True
            self.get_logger().info(
                f"Camera image received and forwarding to /navila/observation/rgb "
                f"({msg.width}x{msg.height}, encoding={msg.encoding})"
            )

    def _odom_callback(self, msg: Odometry):
        """Cache odometry and publish robot state."""
        self.latest_odom = msg
        self._publish_robot_state()

    def _joint_callback(self, msg: JointState):
        """Cache joint states."""
        self.latest_joints = msg

    def _publish_robot_state(self):
        """Aggregate robot state from cached sensor data."""
        if self.latest_odom is None:
            return

        state = RobotState()
        state.header.stamp = self.get_clock().now().to_msg()

        pose = PoseStamped()
        pose.header = self.latest_odom.header
        pose.pose = self.latest_odom.pose.pose
        state.pose = pose

        vel = TwistStamped()
        vel.header = self.latest_odom.header
        vel.twist = self.latest_odom.twist.twist
        state.velocity = vel

        if self.latest_joints is not None:
            state.joint_states = self.latest_joints

        state.locomotion_mode = "humanoid_walking"
        state.ready = self.ws_connected
        state.battery_level = 1.0  # TODO: get from robot notify messages

        self.state_pub.publish(state)

    # =========================================================================
    # Utilities
    # =========================================================================

    def _log_status(self):
        """Periodic status logging."""
        with self.cmd_lock:
            x, y, yaw = self.cmd_x, self.cmd_y, self.cmd_yaw
        mode_str = "DRY RUN" if self.dry_run else (
            "connected" if self.ws_connected else "DISCONNECTED"
        )
        self.get_logger().info(
            f"[Status] mode: {mode_str} | "
            f"cmd: x={x:.2f} y={y:.2f} yaw={yaw:.2f} | "
            f"errors: {self.error_count}"
        )

    @staticmethod
    def _clamp(value: float, min_val: float, max_val: float) -> float:
        return max(min_val, min(max_val, value))

    def destroy_node(self):
        """Clean up: send stop command and close WebSocket."""
        self.get_logger().info("Shutting down OLI bridge, sending stop command...")

        # Send stop
        with self.cmd_lock:
            self.cmd_x = 0.0
            self.cmd_y = 0.0
            self.cmd_yaw = 0.0

        if not self.dry_run:
            # Send a few stop commands to ensure robot receives it
            for _ in range(5):
                self._send_walk_cmd()
                time.sleep(0.03)

            # Close WebSocket
            if self.ws:
                try:
                    self.ws.close()
                except Exception:
                    pass

        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = OLiBridge()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
