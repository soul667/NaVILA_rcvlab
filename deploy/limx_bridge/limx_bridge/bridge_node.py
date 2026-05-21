"""
LimX Dynamics (逐际动力) bridge node.

Converts between LimX robot SDK topics and NaVILA standard message format.
Each robot platform implements a similar bridge package.
"""

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy
from geometry_msgs.msg import Twist, PoseStamped, TwistStamped
from sensor_msgs.msg import Image, CameraInfo, JointState
from nav_msgs.msg import Odometry

from navila_msgs.msg import Action, RobotState


class LimXBridge(Node):
    """
    Bridge between NaVILA standard interface and LimX Dynamics robot.

    Subscribes to:
      - /navila/action (Action) -> converts to LimX velocity commands
    Publishes:
      - /navila/observation/rgb (Image) -> from LimX camera
      - /navila/robot_state (RobotState) -> from LimX odometry/joints
      - /limx/cmd_vel (Twist) -> velocity command to robot

    The bridge handles:
      - Command mapping: VLA action -> robot velocity
      - State aggregation: odom + joints -> RobotState
      - Camera forwarding: LimX camera -> standard topic
    """

    def __init__(self):
        super().__init__("limx_bridge")

        self.declare_parameter("max_linear_vel", 0.5)
        self.declare_parameter("max_angular_vel", 1.0)
        self.declare_parameter("camera_topic", "/limx/camera/color/image_raw")
        self.declare_parameter("odom_topic", "/limx/odom")
        self.declare_parameter("joint_topic", "/limx/joint_states")

        self.max_linear_vel = self.get_parameter("max_linear_vel").value
        self.max_angular_vel = self.get_parameter("max_angular_vel").value
        camera_topic = self.get_parameter("camera_topic").value
        odom_topic = self.get_parameter("odom_topic").value
        joint_topic = self.get_parameter("joint_topic").value

        sensor_qos = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            history=HistoryPolicy.KEEP_LAST,
            depth=1,
        )

        # Subscribe to NaVILA action output
        self.action_sub = self.create_subscription(
            Action, "/navila/action", self._action_callback, 10
        )

        # Subscribe to LimX robot topics
        self.camera_sub = self.create_subscription(
            Image, camera_topic, self._camera_callback, sensor_qos
        )
        self.odom_sub = self.create_subscription(
            Odometry, odom_topic, self._odom_callback, sensor_qos
        )
        self.joint_sub = self.create_subscription(
            JointState, joint_topic, self._joint_callback, sensor_qos
        )

        # Publish to NaVILA standard topics
        self.rgb_pub = self.create_publisher(Image, "/navila/observation/rgb", 10)
        self.state_pub = self.create_publisher(RobotState, "/navila/robot_state", 10)

        # Publish to LimX robot
        self.cmd_vel_pub = self.create_publisher(Twist, "/limx/cmd_vel", 10)

        # State cache
        self.latest_odom = None
        self.latest_joints = None

        self.get_logger().info("LimX bridge initialized")

    def _action_callback(self, msg: Action):
        """Convert NaVILA action to LimX velocity command."""
        cmd = Twist()

        if msg.goal_reached or msg.command == "stop":
            cmd.linear.x = 0.0
            cmd.angular.z = 0.0
        else:
            cmd.linear.x = self._clamp(msg.linear_velocity, -self.max_linear_vel, self.max_linear_vel)
            cmd.angular.z = self._clamp(msg.angular_velocity, -self.max_angular_vel, self.max_angular_vel)

        self.cmd_vel_pub.publish(cmd)

    def _camera_callback(self, msg: Image):
        """Forward LimX camera to NaVILA standard topic."""
        self.rgb_pub.publish(msg)

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

        state.locomotion_mode = "walking"
        state.ready = True
        state.battery_level = 1.0

        self.state_pub.publish(state)

    @staticmethod
    def _clamp(value: float, min_val: float, max_val: float) -> float:
        return max(min_val, min(max_val, value))


def main(args=None):
    rclpy.init(args=args)
    node = LimXBridge()
    rclpy.spin(node)
    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
