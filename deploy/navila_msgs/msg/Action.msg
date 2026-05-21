# VLA action output - robot-agnostic navigation command

std_msgs/Header header

# High-level navigation command
# e.g., "turn_left", "turn_right", "go_forward", "stop"
string command

# Angular velocity (rad/s) - yaw command
float64 angular_velocity

# Linear velocity (m/s) - forward/backward
float64 linear_velocity

# Confidence score [0.0, 1.0]
float64 confidence

# Model reasoning text (for debugging/visualization)
string reasoning

# Whether the navigation goal is reached
bool goal_reached
