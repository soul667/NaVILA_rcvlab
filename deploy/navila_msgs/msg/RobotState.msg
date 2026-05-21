# Standardized robot state message

std_msgs/Header header

# Robot base pose in odom frame
geometry_msgs/PoseStamped pose

# Robot base velocity
geometry_msgs/TwistStamped velocity

# Joint states (for legged robots)
sensor_msgs/JointState joint_states

# Battery level [0.0, 1.0]
float64 battery_level

# Robot-specific mode (e.g., "standing", "walking", "sitting")
string locomotion_mode

# Is the robot ready to receive commands
bool ready
